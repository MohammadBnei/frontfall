// Runs before the game and in any browser, even one too old to read the game's code
// (which would leave a blank page). The game has its own, translated check once it starts.
(function () {
  var ok =
    "noModule" in HTMLScriptElement.prototype &&
    typeof Object.hasOwn === "function" &&
    typeof structuredClone === "function" &&
    typeof Worker === "function";
  if (ok) return;
  var fr = /^fr/i.test(navigator.language || "");
  var text = fr
    ? "Ce navigateur est trop ancien pour Frontfall. Ouvrez le jeu dans un Chrome, Firefox, Safari ou Edge récent."
    : "This browser is too old for Frontfall. Open the game in a recent Chrome, Firefox, Safari or Edge.";
  document.addEventListener("DOMContentLoaded", function () {
    var notice = document.createElement("p");
    notice.className = "notice";
    notice.setAttribute("role", "alert");
    notice.textContent = text;
    document.body.appendChild(notice);
  });
})();
