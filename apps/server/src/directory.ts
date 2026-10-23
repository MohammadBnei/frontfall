import { randomInt } from "node:crypto";
import { newGameId } from "./ids.ts";
import { Room, type RoomObserver, type RoomSettings, type Seat } from "./room.ts";

export interface PublicGame {
  id: string;
  map: string;
  players: number;
  capacity: number;
  startsIn: number | null;
}

export interface DirectoryOptions {
  maxRooms: number;
  publicGame: Omit<RoomSettings, "visibility">;
  privateGame: Omit<RoomSettings, "visibility">;
  observer?: RoomObserver;
}

/** Every game of the server, by id, from creation until it finishes. */
export class Directory {
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly options: DirectoryOptions) {}

  get size(): number {
    return this.rooms.size;
  }

  all(): IterableIterator<Room> {
    return this.rooms.values();
  }

  find(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  /** The public game that will start soonest, or a new one; undefined when the server is full. */
  quickMatch(): Room | undefined {
    let best: Room | undefined;
    for (const room of this.rooms.values()) {
      if (room.settings.visibility !== "public") continue;
      if (room.state !== "open" && room.state !== "starting") continue;
      if (room.playerCount >= room.settings.capacity) continue;
      if (!best || room.playerCount > best.playerCount) best = room;
    }
    return best ?? this.create("public");
  }

  create(visibility: RoomSettings["visibility"]): Room | undefined {
    if (this.rooms.size >= this.options.maxRooms) return undefined;
    const base = visibility === "public" ? this.options.publicGame : this.options.privateGame;
    const room = new Room(
      newGameId(),
      { ...base, visibility },
      randomInt(2 ** 31),
      this.options.observer,
    );
    this.rooms.set(room.id, room);
    return room;
  }

  /** The running game and seat a reconnect token belongs to. */
  findSeat(token: string): { room: Room; seat: Seat } | undefined {
    for (const room of this.rooms.values()) {
      if (room.state !== "running") continue;
      const seat = room.seatFor(token);
      if (seat) return { room, seat };
    }
    return undefined;
  }

  /** Advances every game by one tick and forgets the finished ones. */
  update(now: number): void {
    for (const [id, room] of this.rooms) {
      room.update(now);
      if (room.state === "finished") this.rooms.delete(id);
    }
  }

  /** Forgets games that finished between two ticks, such as a lobby everyone left. */
  sweep(): void {
    for (const [id, room] of this.rooms) {
      if (room.state === "finished") this.rooms.delete(id);
    }
  }

  publicGames(now: number): PublicGame[] {
    const games: PublicGame[] = [];
    for (const room of this.rooms.values()) {
      if (room.settings.visibility !== "public") continue;
      if (room.state !== "open" && room.state !== "starting") continue;
      games.push({
        id: room.id,
        map: room.settings.map,
        players: room.playerCount,
        capacity: room.settings.capacity,
        startsIn: room.startsIn(now),
      });
    }
    return games;
  }

  stopAll(): void {
    for (const room of this.rooms.values()) room.stop();
    this.rooms.clear();
  }
}
