import { Accounts, accountsFile } from "./accounts.ts";
import { createAuth, type Auth } from "./auth.ts";
import type { Clock } from "./clock.ts";
import { clientErrorsFile, loadClientErrors, saveClientErrors } from "./client-errors.ts";
import type { Directory } from "./directory.ts";
import type { Ids } from "./ids.ts";
import type { Logger } from "./log.ts";
import { Moderation } from "./moderation.ts";
import { isAllowedOrigin } from "./origin.ts";
import { gamesDirectory, loadGames, saveGame } from "./saved-games.ts";
import type { ServerOptions } from "./server-options.ts";
import {
  exportMonths,
  loadUsage,
  monthsDirectory,
  saveUsage,
  usageFile,
  UsageStats,
} from "./usage.ts";

export interface PersistenceSettings {
  options: ServerOptions;
  clock: Clock;
  ids: Ids;
  logger: Logger;
  games: Directory;
  /** The maps the server knows, which the usage counts accept. */
  maps: ReadonlySet<string>;
  /** Simulation build the saved games belong to. */
  simulation: string;
}

/** What the server keeps in its data directory, loaded at the start and saved on a schedule and at the end. */
export interface Persistence {
  readonly usage: UsageStats;
  readonly moderation: Moderation;
  /** Whether running games are saved on close and taken back at the next start. */
  readonly keepsGames: boolean;
  /**
   * Saves the running games for the next run, which takes them back if it has
   * the same simulation build. Their players are not told the game ended:
   * their pages reconnect until the server is back.
   */
  keepGames: () => void;
  /** Stops the periodic save, then writes the usage counts and the reports; never throws. */
  saveCounts: () => void;
}

/**
 * Loads what the last run kept (the games, the usage counts, the client
 * errors, the bans), and starts saving the usage counts every few minutes.
 * Whatever cannot be read is logged and left out: the server starts anyway.
 */
export function openPersistence(settings: PersistenceSettings): Persistence {
  const { options, clock, ids, logger, games, simulation } = settings;
  const savedGames = options.dataDir === undefined ? undefined : gamesDirectory(options.dataDir);
  if (savedGames !== undefined) {
    const { games: saved, refused } = loadGames(savedGames, simulation);
    const now = clock.now();
    for (const game of saved) {
      if (games.restore(game, now))
        logger.info("game_restored", { game: game.id, ticks: game.log.ends.length });
      else refused.push({ file: game.id, reason: "unreadable" });
    }
    for (const { file, reason } of refused) logger.warn("game_not_restored", { file, reason });
  }
  const keepGames = (): void => {
    if (savedGames === undefined) return;
    const now = clock.now();
    for (const room of games.all()) {
      const saved = room.playerCount > 0 ? room.save(now) : undefined;
      if (!saved) continue;
      try {
        saveGame(savedGames, simulation, saved);
        room.suspend();
        logger.info("game_saved", { game: room.id, ticks: room.log.length });
      } catch (error) {
        logger.warn("game_not_saved", { game: room.id, error: (error as Error).message });
      }
    }
  };

  const usage = new UsageStats({ release: options.release ?? "dev", maps: settings.maps });
  const usageAt = options.dataDir === undefined ? undefined : usageFile(options.dataDir);
  const errorsAt = options.dataDir === undefined ? undefined : clientErrorsFile(options.dataDir);
  if (usageAt === undefined) {
    logger.warn("usage_in_memory", { reason: "no data directory" });
  } else {
    const error = loadUsage(usage, usageAt);
    if (error) logger.warn("usage_not_loaded", { error: error.message });
  }
  if (errorsAt !== undefined) {
    const error = loadClientErrors(usage.errors, errorsAt);
    if (error) logger.warn("client_errors_not_loaded", { error: error.message });
  }
  /** Writes the usage counts, if there is somewhere to keep them; never stops the server. */
  const keepUsage = (): void => {
    if (usageAt === undefined) return;
    try {
      saveUsage(usage, usageAt, clock.now());
      exportMonths(usage, monthsDirectory(usageAt), clock.now(), (message) => {
        logger.warn("usage_month_bad", { error: message });
      });
    } catch (error) {
      logger.warn("usage_not_saved", { error: (error as Error).message });
    }
    if (errorsAt === undefined) return;
    try {
      saveClientErrors(usage.errors, errorsAt, clock.now());
    } catch (error) {
      logger.warn("client_errors_not_saved", { error: (error as Error).message });
    }
  };
  const moderation = new Moderation(options.dataDir, clock.now(), options.reportRate, clock, ids);
  try {
    moderation.reload();
  } catch (error) {
    logger.warn("bans_not_loaded", { error: (error as Error).message });
  }
  const usageSaver = clock.setInterval(keepUsage, options.usageSaveIntervalMs ?? 5 * 60_000);
  usageSaver.unref();

  return {
    usage,
    moderation,
    keepsGames: savedGames !== undefined,
    keepGames,
    saveCounts() {
      usageSaver.clear();
      keepUsage();
      try {
        moderation.flush();
      } catch (error) {
        logger.warn("reports_not_saved", { error: (error as Error).message });
      }
    },
  };
}

/** Sign-in, when a service or a mailbox is set up and accounts have somewhere to be kept. */
export function startAuth(
  options: ServerOptions,
  clock: Clock,
  ids: Ids,
  logger: Logger,
): Auth | undefined {
  const settings = options.auth;
  if (!settings || (Object.keys(settings.clients).length === 0 && !settings.mail)) return undefined;
  if (options.dataDir === undefined) {
    logger.warn("accounts_off", { reason: "no data directory" });
    return undefined;
  }
  const accounts = new Accounts(
    accountsFile(options.dataDir),
    (error) => {
      logger.warn("accounts_not_saved", {
        reason: (error as NodeJS.ErrnoException).code ?? "write",
      });
    },
    { clock, ids },
  );
  const { error, usable } = accounts.load();
  if (error) logger.warn("accounts_not_loaded", { error: error.message });
  // Starting empty would replace a file that is still there at the first sign-in.
  if (!usable) {
    logger.warn("accounts_off", { reason: "accounts file cannot be read" });
    return undefined;
  }
  logger.info("accounts_loaded", { accounts: accounts.size });
  // Unset, the socket accepts any page; changes to an account never do.
  return createAuth(
    settings,
    accounts,
    logger,
    (origin) => !!options.allowedOrigin && isAllowedOrigin(origin, options.allowedOrigin),
    clock,
    ids,
  );
}
