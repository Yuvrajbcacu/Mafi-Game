import { initializeApp } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  get,
  onValue,
  update
} from "https://www.gstatic.com/firebasejs/10.4.0/firebase-database.js";

// =========================================================
// FIREBASE CONFIG
// =========================================================

const firebaseConfig = {
  apiKey: "AIzaSyDgg2Qzog5ky2M-LEb0Oigllli1he1le3o",
  authDomain: "realmafia-dbad3.firebaseapp.com",
  databaseURL: "https://realmafia-dbad3-default-rtdb.firebaseio.com",
  projectId: "realmafia-dbad3",
  storageBucket: "realmafia-dbad3.firebasestorage.app",
  messagingSenderId: "260346311431",
  appId: "1:260346311431:web:fe048055078bd089a00ba2",
  measurementId: "G-DV6SC1FBKB"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// =========================================================
// STATE
// =========================================================

let isHost = false;
let myRoomCode = localStorage.getItem("roomCode") || null;
let myPlayerId = localStorage.getItem("playerId") || null;

let playersCache = {};
let currentPhase = "";
let previousPhase = "";
let myRoleData = {};

let isAdvancing = false;
let phaseTransitionInProgress = false;

// =========================================================
// ROLE ROSTER
// =========================================================

const ROLES = {
  Mafia: {
    team: "Mafia",
    desc: "You are part of the Mafia team. Each night, choose one player to eliminate and optionally choose one player to recruit. Blend in during the day.",
    win: "Reach parity with the living village."
  },

  Farmer: {
    team: "Mafia",
    desc: "You are on the Mafia team. Once per game at night, you can frame a player so that the Detective sees them as Mafia.",
    win: "Reach parity with the living village."
  },

  Fool: {
    team: "Neutral",
    desc: "You have no night powers. Act suspicious and convince the town to vote you out.",
    win: "Get voted out during Daytime voting."
  },

  Doctor: {
    team: "Village",
    desc: "Choose one player each night to protect from the Mafia's attack. You can protect yourself.",
    win: "Eliminate the Mafia."
  },

  Detective: {
    team: "Village",
    desc: "Investigate one player each night to learn if they are 'Mafia' or 'Not Mafia'.",
    win: "Eliminate the Mafia."
  },

  Jailor: {
    team: "Village",
    desc: "You have 1 bullet for the entire game. Shoot a suspect at night.",
    win: "Eliminate the Mafia.",
    perk: true
  },

  Snatcher: {
    team: "Village",
    desc: "Once per game, snatch someone's role at night. They become a Villager and you take their role.",
    win: "Eliminate the Mafia.",
    perk: true
  },

  Reviver: {
    team: "Village",
    desc: "Once per game, bring one dead player back to life during the night.",
    win: "Eliminate the Mafia.",
    perk: true
  },

  Bodyguard: {
    team: "Village",
    desc: "Guard one player each night. If attacked, they survive and you die instead.",
    win: "Eliminate the Mafia."
  },

  Lookout: {
    team: "Village",
    desc: "Watch one player each night to see if anyone visited them.",
    win: "Eliminate the Mafia."
  },

  Mayor: {
    team: "Village",
    desc: "Your vote during daytime secretly counts as 2 votes.",
    win: "Eliminate the Mafia."
  },

  Villager: {
    team: "Village",
    desc: "You have no night abilities. Use daytime logic to find the Mafia.",
    win: "Eliminate the Mafia."
  }
};

// =========================================================
// DOM HELPERS
// =========================================================

const switchView = (id) => {
  document
    .querySelectorAll(".view")
    .forEach((v) => v.classList.remove("active"));

  const target = document.getElementById(id);

  if (target) {
    target.classList.add("active");
  }
};

const el = (id) => document.getElementById(id);

// =========================================================
// INIT / RECONNECT
// =========================================================

window.onload = async () => {
  if (myRoomCode && myPlayerId) {
    try {
      const pSnap = await get(
        ref(db, `rooms/${myRoomCode}/players/${myPlayerId}`)
      );

      if (pSnap.exists()) {
        isHost = false;

        listenToRoom(myRoomCode);
        switchView("view-player");
      } else {
        clearSession();
      }
    } catch (error) {
      console.error("Reconnect failed:", error);
      clearSession();
    }
  }
};

const clearSession = () => {
  localStorage.removeItem("roomCode");
  localStorage.removeItem("playerId");

  myRoomCode = null;
  myPlayerId = null;

  switchView("view-menu");
};

// =========================================================
// CREATE ROOM
// =========================================================

el("btn-create-room").onclick = async () => {
  try {
    myRoomCode = Math.random()
      .toString(36)
      .substring(2, 6)
      .toUpperCase();

    isHost = true;

    await set(ref(db, `rooms/${myRoomCode}`), {
      gameState: {
        phase: "LOBBY",
        round: 1,
        winner: null
      },

      players: {},

      logs: {
        announcement: "Waiting for players to join..."
      }
    });

    el("host-room-code").innerText = myRoomCode;

    listenToRoom(myRoomCode);

    switchView("view-host");
  } catch (error) {
    console.error("Room creation failed:", error);
    alert("Could not create room.");
  }
};

// =========================================================
// JOIN ROOM
// =========================================================

el("btn-join-room").onclick = async () => {
  const code = el("join-room-code").value
    .trim()
    .toUpperCase();

  const name = el("join-nickname").value.trim();

  if (code.length !== 4 || !name) {
    return alert("Enter valid code and name.");
  }

  try {
    const roomSnap = await get(
      ref(db, `rooms/${code}`)
    );

    if (!roomSnap.exists()) {
      return alert("Room not found.");
    }

    const roomData = roomSnap.val();

    if (roomData.gameState.phase !== "LOBBY") {
      return alert("Game already in progress.");
    }

    myPlayerId = `p_${Date.now()}`;
    myRoomCode = code;

    localStorage.setItem("roomCode", myRoomCode);
    localStorage.setItem("playerId", myPlayerId);

    await set(
      ref(db, `rooms/${myRoomCode}/players/${myPlayerId}`),
      {
        name,
        role: "",
        isAlive: true,

        nightTarget: null,
        recruitTarget: null,
        voteTarget: null,
        pendingRecruitment: false,

        privateLogs: [],

        perks: {
          bulletUsed: false,
          abilityUsed: false
        }
      }
    );

    listenToRoom(myRoomCode);

    switchView("view-player");

  } catch (error) {
    console.error("Join failed:", error);
    alert("Could not join room.");
  }
};

// =========================================================
// REALTIME ROOM LISTENER
// =========================================================

function listenToRoom(roomCode) {
  onValue(
    ref(db, `rooms/${roomCode}`),
    (snapshot) => {

      const data = snapshot.val();

      if (!data) {

        if (!isHost) {
          alert("The host has closed this room.");
        }

        return clearSession();
      }

      playersCache = data.players || {};

      currentPhase =
        data.gameState?.phase || "LOBBY";

      if (isHost) {
        updateHostUI(data);
      } else {
        updatePlayerUI(data);
      }
    },
    (error) => {
      console.error("Room listener error:", error);
    }
  );
}

// =========================================================
// HOST AUDIO
// =========================================================

function playPhaseAudio(phase) {

  if (!isHost) {
    return;
  }

  const night = el("audio-night");
  const dawn = el("audio-dawn");
  const day = el("audio-day");

  if (!night || !dawn || !day) {
    return;
  }

  night.pause();
  dawn.pause();
  day.pause();

  try {

    if (phase === "NIGHT") {

      night.currentTime = 0;
      night.play();

    } else if (phase === "DAWN") {

      dawn.currentTime = 0;
      dawn.play();

    } else if (
      phase === "DAY_VOTE" ||
      phase === "LOBBY"
    ) {

      day.currentTime = 0;
      day.play();

    }

  } catch (error) {

    console.log(
      "Audio play blocked by browser:",
      error
    );

  }
}

// =========================================================
// HOST UI
// =========================================================

function updateHostUI(data) {

  el("host-phase").innerText =
    data.gameState.phase;

  el("host-announcements").innerText =
    data.logs?.announcement || "";

  // -----------------------------------------
  // Phase audio
  // -----------------------------------------

  if (
    data.gameState.phase !== previousPhase
  ) {

    previousPhase =
      data.gameState.phase;

    playPhaseAudio(
      data.gameState.phase
    );
  }

  // -----------------------------------------
  // Determine action completion
  // -----------------------------------------

  let aliveCount = 0;

  let allNightActionsDone = true;
  let allDayVotesDone = true;

  el("host-alive-list").innerHTML = "";
  el("host-dead-list").innerHTML = "";

  Object.entries(playersCache).forEach(
    ([id, p]) => {

      const li =
        document.createElement("li");

      li.style.display = "flex";
      li.style.justifyContent = "space-between";
      li.style.alignItems = "center";

      const textSpan =
        document.createElement("span");

      textSpan.innerText = p.name;

      li.appendChild(textSpan);

      // -------------------------------------
      // Kick button
      // -------------------------------------

      const kickBtn =
        document.createElement("button");

      kickBtn.innerText = "KICK";

      kickBtn.style.padding = "4px 8px";
      kickBtn.style.width = "auto";
      kickBtn.style.fontSize = "0.7rem";

      kickBtn.onclick = async () => {

        if (
          confirm(
            `Are you sure you want to remove ${p.name} from the game?`
          )
        ) {

          try {

            await set(
              ref(
                db,
                `rooms/${myRoomCode}/players/${id}`
              ),
              null
            );

          } catch (error) {

            console.error(
              "Kick failed:",
              error
            );

          }
        }
      };

      li.appendChild(kickBtn);

      // -------------------------------------
      // Alive / dead
      // -------------------------------------

      if (p.isAlive) {

        aliveCount++;

        el("host-alive-list")
          .appendChild(li);

        // Night action required (Mafia needs nightTarget, Farmer needs nightTarget if alive, etc.)
        const isMafiaTeam = (p.role === "Mafia" || p.role === "Silent Mafia");
        const needsNightAction = isMafiaTeam || ["Doctor", "Detective", "Jailor", "Snatcher", "Reviver", "Bodyguard", "Lookout", "Farmer"].includes(p.role);
        
        if (needsNightAction && !p.nightTarget && !(p.role === "Reviver" && p.perks.abilityUsed)) {
          allNightActionsDone = false;
        }

        // Day vote required
        if (!p.voteTarget) {
          allDayVotesDone = false;
        }

      } else {

        el("host-dead-list")
          .appendChild(li);

      }

    }
  );

  el("host-alive-count").innerText =
    aliveCount;

  const btnStart =
    el("btn-start-game");

  const btnAdvance =
    el("btn-advance-phase");

  // -----------------------------------------
  // Lobby buttons
  // -----------------------------------------

  if (
    data.gameState.phase === "LOBBY"
  ) {

    btnStart.classList.remove("hidden");
    btnAdvance.classList.add("hidden");

  } else {

    btnStart.classList.add("hidden");
    btnAdvance.classList.remove("hidden");
  }

  // -----------------------------------------
  // AUTO ADVANCE - NIGHT
  // -----------------------------------------

  if (
    data.gameState.phase === "NIGHT" &&
    aliveCount > 0 &&
    allNightActionsDone &&
    !isAdvancing &&
    !phaseTransitionInProgress
  ) {

    isAdvancing = true;

    setTimeout(
      async () => {

        try {

          if (currentPhase === "NIGHT") {

            phaseTransitionInProgress =
              true;

            await advancePhase("DAWN");
          }

        } catch (error) {

          console.error(
            "Night auto advance failed:",
            error
          );

        } finally {

          phaseTransitionInProgress =
            false;

          isAdvancing = false;
        }

      },
      1500
    );
  }

  // -----------------------------------------
  // AUTO ADVANCE - DAY VOTE
  // -----------------------------------------

  else if (
    data.gameState.phase === "DAY_VOTE" &&
    aliveCount > 0 &&
    allDayVotesDone &&
    !isAdvancing &&
    !phaseTransitionInProgress
  ) {

    isAdvancing = true;

    setTimeout(
      async () => {

        try {

          if (
            currentPhase === "DAY_VOTE"
          ) {

            phaseTransitionInProgress =
              true;

            await advancePhase("NIGHT");
          }

        } catch (error) {

          console.error(
            "Day vote auto advance failed:",
            error
          );

        } finally {

          phaseTransitionInProgress =
            false;

          isAdvancing = false;
        }

      },
      1500
    );
  }

  // -----------------------------------------
  // Winner
  // -----------------------------------------

  if (data.gameState.winner) {

    btnAdvance.disabled = true;

    return;
  }

  btnAdvance.disabled = false;

  // -----------------------------------------
  // Manual phase flow
  // -----------------------------------------

  const phaseFlow = {
    LOBBY: "NIGHT",
    NIGHT: "DAWN",
    DAWN: "DAY_VOTE",
    DAY_VOTE: "NIGHT"
  };

  const nextPhase =
    phaseFlow[currentPhase] || "NIGHT";

  btnAdvance.innerText =
    `Advance to ${nextPhase}`;

  btnAdvance.onclick = async () => {

    if (phaseTransitionInProgress) {
      return;
    }

    phaseTransitionInProgress = true;

    try {

      await advancePhase(nextPhase);

    } catch (error) {

      console.error(
        "Manual phase advance failed:",
        error
      );

    } finally {

      phaseTransitionInProgress = false;
    }
  };
}

// =========================================================
// START GAME
// =========================================================

el("btn-start-game").onclick = async () => {

  const pKeys =
    Object.keys(playersCache);

  if (
    pKeys.length < 6 ||
    pKeys.length > 9
  ) {

    return alert(
      "Need 6 to 9 players."
    );
  }

  let pool = [
    "Fool",
    "Doctor",
    "Detective",
    "Jailor",
    "Reviver",
    "Lookout",
    "Mayor",
    "Snatcher",
    "Villager"
  ];

  pool = pool
    .sort(() => 0.5 - Math.random())
    .slice(
      0,
      pKeys.length - 2
    );

  pool.push("Mafia");
  pool.push("Farmer");

  pool = pool.sort(
    () => 0.5 - Math.random()
  );

  const updates = {};

  pKeys.forEach(
    (key, i) => {

      updates[
        `rooms/${myRoomCode}/players/${key}/role`
      ] = pool[i];

      updates[
        `rooms/${myRoomCode}/players/${key}/isAlive`
      ] = true;

      updates[
        `rooms/${myRoomCode}/players/${key}/nightTarget`
      ] = null;

      updates[
        `rooms/${myRoomCode}/players/${key}/recruitTarget`
      ] = null;

      updates[
        `rooms/${myRoomCode}/players/${key}/voteTarget`
      ] = null;

      updates[
        `rooms/${myRoomCode}/players/${key}/pendingRecruitment`
      ] = false;

    }
  );

  updates[
    `rooms/${myRoomCode}/gameState/phase`
  ] = "NIGHT";

  updates[
    `rooms/${myRoomCode}/gameState/winner`
  ] = null;

  updates[
    `rooms/${myRoomCode}/logs/announcement`
  ] =
    "Night falls. Check your devices.";

  try {

    await update(
      ref(db),
      updates
    );

  } catch (error) {

    console.error(
      "Start game failed:",
      error
    );

    alert("Could not start game.");
  }
};

// =========================================================
// PHASE RESOLUTION
// =========================================================

async function advancePhase(nextPhase) {

  if (!nextPhase) {
    return;
  }

  const updates = {
    [`rooms/${myRoomCode}/gameState/phase`]:
      nextPhase
  };

  // =======================================================
  // NIGHT -> DAWN
  // =======================================================

  if (nextPhase === "DAWN") {

    let actions = {};
    let deaths = [];
    let logs = {};

    const addLog = (id, msg) => {

      if (!logs[id]) {
        logs[id] = [];
      }

      logs[id].push(msg);
    };

    let revivedName = "";
    let revivedId = null;

    // -----------------------------------------
    // Collect actions
    // -----------------------------------------

    Object.entries(playersCache).forEach(
      ([id, p]) => {

        if (
          p.isAlive &&
          p.nightTarget &&
          p.nightTarget !== "sleep"
        ) {

          actions[p.role] = {
            actor: id,
            target: p.nightTarget
          };
        }
      }
    );

    // Support multiple Mafia/Silent Mafia kill actions collection
    let mafiaKills = [];
    let mafiaRecruits = [];
    let farmerFrames = [];

    Object.entries(playersCache).forEach(([id, p]) => {
      if (p.isAlive) {
        if ((p.role === "Mafia" || p.role === "Silent Mafia") && p.nightTarget && p.nightTarget !== "sleep") {
          mafiaKills.push({ actor: id, target: p.nightTarget });
        }
        if (p.role === "Mafia" && p.recruitTarget && p.recruitTarget !== "none") {
          mafiaRecruits.push({ actor: id, target: p.recruitTarget });
        }
        if (p.role === "Farmer" && p.nightTarget && p.nightTarget !== "sleep") {
          farmerFrames.push({ actor: id, target: p.nightTarget });
        }
      }
    });

    // -----------------------------------------
    // Doctor / Bodyguard
    // -----------------------------------------

    const docTarget =
      actions["Doctor"]
        ? actions["Doctor"].target
        : null;

    const bgTarget =
      actions["Bodyguard"]
        ? actions["Bodyguard"].target
        : null;

    // -----------------------------------------
    // Jailor
    // -----------------------------------------

    if (actions["Jailor"]) {

      const target =
        actions["Jailor"].target;

      if (target !== docTarget) {

        if (playersCache[target]) {
          deaths.push(target);
        }
      }

      updates[
        `rooms/${myRoomCode}/players/${actions["Jailor"].actor}/perks/bulletUsed`
      ] = true;
    }

    // -----------------------------------------
    // Farmer Frame Resolution
    // -----------------------------------------
    let framedPlayerId = null;
    if (farmerFrames.length > 0) {
      framedPlayerId = farmerFrames[0].target;
    }

    // -----------------------------------------
    // Mafia Single Kill & Recruitment Resolution
    // -----------------------------------------
    let finalMafiaKillTarget = null;
    if (mafiaKills.length > 0) {
      // Deterministic: pick the first valid kill target or unique if multiple
      finalMafiaKillTarget = mafiaKills[0].target;
    }

    if (finalMafiaKillTarget) {
      const target = finalMafiaKillTarget;

      if (target === docTarget) {
        // Protected by doctor
      } else if (target === bgTarget) {
        const bodyguardId = actions["Bodyguard"] ? actions["Bodyguard"].actor : null;
        if (bodyguardId && docTarget !== bodyguardId) {
          if (playersCache[bodyguardId]) {
            deaths.push(bodyguardId);
          }
        }
      } else {
        if (playersCache[target]) {
          deaths.push(target);
        }
      }
    }

    // Process Recruitment
    if (mafiaRecruits.length > 0) {
      // Check count of living mafia players first (< 2)
      let livingMafiaCount = 0;
      Object.values(playersCache).forEach(p => {
        if (p.isAlive && (p.role === "Mafia" || p.role === "Silent Mafia")) {
          livingMafiaCount++;
        }
      });

      if (livingMafiaCount < 2) {
        const recruitTargetId = mafiaRecruits[0].target;
        // Make sure target is not Farmer and is alive
        if (playersCache[recruitTargetId] && playersCache[recruitTargetId].isAlive && playersCache[recruitTargetId].role !== "Farmer") {
          updates[`rooms/${myRoomCode}/players/${recruitTargetId}/pendingRecruitment`] = true;
          updates[`rooms/${myRoomCode}/players/${mafiaRecruits[0].actor}/perks/abilityUsed`] = true;
        }
      }
    }

    // -----------------------------------------
    // Detective
    // -----------------------------------------

    if (actions["Detective"]) {

      const target =
        actions["Detective"].target;

      if (playersCache[target]) {

        let isMafia = playersCache[target].role === "Mafia" || playersCache[target].role === "Silent Mafia";
        if (target === framedPlayerId) {
          isMafia = true;
        }

        addLog(
          actions["Detective"].actor,
          `${playersCache[target].name} is ${
            isMafia
              ? "MAFIA"
              : "NOT MAFIA"
          }.`
        );
      }
    }

    // -----------------------------------------
    // Lookout
    // -----------------------------------------

    if (actions["Lookout"]) {

      const target =
        actions["Lookout"].target;

      let visitors = 0;

      Object.values(actions).forEach(
        (action) => {

          if (
            action.target === target
          ) {
            visitors++;
          }

        }
      );

      mafiaKills.forEach(k => { if (k.target === target) visitors++; });
      farmerFrames.forEach(f => { if (f.target === target) visitors++; });

      if (playersCache[target]) {

        addLog(
          actions["Lookout"].actor,
          `${visitors} people visited ${playersCache[target].name}.`
        );
      }
    }

    // -----------------------------------------
    // Snatcher
    // -----------------------------------------

    if (actions["Snatcher"]) {

      const snatcherId =
        actions["Snatcher"].actor;

      if (!deaths.includes(snatcherId)) {

        const target =
          actions["Snatcher"].target;

        if (
          target &&
          playersCache[target] &&
          playersCache[target].isAlive &&
          target !== snatcherId
        ) {

          const targetRole =
            playersCache[target].role;

          updates[
            `rooms/${myRoomCode}/players/${snatcherId}/role`
          ] = targetRole;

          updates[
            `rooms/${myRoomCode}/players/${target}/role`
          ] = "Villager";

          updates[
            `rooms/${myRoomCode}/players/${snatcherId}/perks/abilityUsed`
          ] = true;

          addLog(
            snatcherId,
            `You snatched a role! You are now the ${targetRole}.`
          );

          addLog(
            target,
            `Your role was snatched! You are now a Villager.`
          );
        }
      }
    }

    // -----------------------------------------
    // Reviver
    // -----------------------------------------

    if (actions["Reviver"]) {

      const targetId =
        actions["Reviver"].target;

      const reviverId =
        actions["Reviver"].actor;

      if (
        targetId &&
        playersCache[targetId] &&
        !playersCache[targetId].isAlive &&
        targetId !== reviverId
      ) {

        revivedId = targetId;

        revivedName =
          playersCache[targetId].name;

        updates[
          `rooms/${myRoomCode}/players/${targetId}/isAlive`
        ] = true;

        updates[
          `rooms/${myRoomCode}/players/${targetId}/nightTarget`
        ] = null;

        updates[
          `rooms/${myRoomCode}/players/${targetId}/voteTarget`
        ] = null;

        // If revived player was a recruited mafia before dying, restore as Silent Mafia
        const oldRole = playersCache[targetId].role;
        // Check if they were recruited previously (we can check if they were recruited or just handle based on state if needed, but per rule: "revived recruited Mafia return as Silent Mafia")
        // To be safe, if they had been recruited (their role was Mafia but they weren't the original mafia, or stored explicitly), let's mark recruited players or check if they were converted. Let's add a flag `wasRecruited: true` when recruited!
        if (playersCache[targetId].wasRecruited) {
          updates[`rooms/${myRoomCode}/players/${targetId}/role`] = "Silent Mafia";
        }

        updates[
          `rooms/${myRoomCode}/players/${reviverId}/perks/abilityUsed`
        ] = true;
      }
    }

    // -----------------------------------------
    // Apply deaths
    // -----------------------------------------

    const uniqueDeaths =
      [...new Set(deaths)];

    uniqueDeaths.forEach(
      (dId) => {

        if (dId === revivedId) {
          return;
        }

        if (playersCache[dId]) {

          updates[
            `rooms/${myRoomCode}/players/${dId}/isAlive`
          ] = false;
        }
      }
    );

    // -----------------------------------------
    // Private logs
    // -----------------------------------------

    Object.entries(logs).forEach(
      ([id, msgArray]) => {

        updates[
          `rooms/${myRoomCode}/players/${id}/privateLogs`
        ] = msgArray;
      }
    );

    // -----------------------------------------
    // Dawn announcement
    // -----------------------------------------

    const actualDeaths =
      uniqueDeaths.filter(
        (id) => id !== revivedId
      );

    const deadNames =
      actualDeaths
        .filter(
          (id) => playersCache[id]
        )
        .map(
          (id) => playersCache[id].name
        )
        .join(", ");

    let finalAnnounce;

    if (deadNames) {

      finalAnnounce =
        `The village wakes to find ${deadNames} murdered.`;

    } else {

      finalAnnounce =
        "The village wakes peacefully. No one died.";
    }

    if (revivedName) {

      finalAnnounce +=
        ` By a miracle, ${revivedName} was revived from the dead!`;
    }

    updates[
      `rooms/${myRoomCode}/logs/announcement`
    ] = finalAnnounce;

    // -----------------------------------------
    // Clear night targets
    // -----------------------------------------

    Object.keys(playersCache).forEach(
      (id) => {

        updates[
          `rooms/${myRoomCode}/players/${id}/nightTarget`
        ] = null;
        updates[
          `rooms/${myRoomCode}/players/${id}/recruitTarget`
        ] = null;
      }
    );
  }

  // =======================================================
  // DAY VOTE -> NIGHT
  // =======================================================

  if (nextPhase === "NIGHT") {

  let votes = {};
  let skipVotes = 0;

  Object.values(playersCache).forEach(
    (p) => {

      if (
        !p.isAlive ||
        !p.voteTarget
      ) {
        return;
      }

      const weight =
        p.role === "Mayor"
          ? 2
          : 1;

      if (p.voteTarget === "skip") {

        skipVotes += weight;

      } else {

        const target =
          playersCache[p.voteTarget];

        if (
          target &&
          target.isAlive
        ) {
          votes[p.voteTarget] =
            (votes[p.voteTarget] || 0) +
            weight;
        }
      }
    }
  );

  let maxPlayerVotes = 0;
  let leaders = [];

  Object.entries(votes).forEach(
    ([target, voteCount]) => {

      if (
        voteCount > maxPlayerVotes
      ) {
        maxPlayerVotes = voteCount;
        leaders = [target];

      } else if (
        voteCount === maxPlayerVotes &&
        voteCount > 0
      ) {
        leaders.push(target);
      }
    }
  );

  let executed = null;

  if (
    leaders.length === 1 &&
    maxPlayerVotes > skipVotes
  ) {
    executed = leaders[0];
  }

  if (
    executed &&
    playersCache[executed] &&
    playersCache[executed].isAlive
  ) {

    updates[
      `rooms/${myRoomCode}/players/${executed}/isAlive`
    ] = false;

    updates[
      `rooms/${myRoomCode}/logs/announcement`
    ] =
      `${playersCache[executed].name} was voted out.`;

    if (
      playersCache[executed].role === "Fool"
    ) {
      updates[
        `rooms/${myRoomCode}/gameState/winner`
      ] = "FOOL";
    }

  } else {

    let reason = "";

    if (
      skipVotes > maxPlayerVotes &&
      skipVotes > 0
    ) {
      reason = "Skip received the majority.";

    } else if (
      skipVotes === maxPlayerVotes &&
      skipVotes > 0
    ) {
      reason = "Skip tied for the highest vote.";

    } else if (
      leaders.length > 1
    ) {
      reason = "The vote was tied.";

    } else {
      reason = "Nobody received enough votes.";
    }

    updates[
      `rooms/${myRoomCode}/logs/announcement`
    ] =
      `${reason} Nobody was executed.`;
  }

  Object.keys(playersCache).forEach(
    (id) => {
      updates[
        `rooms/${myRoomCode}/players/${id}/voteTarget`
      ] = null;
    }
  );
}
  // =======================================================
  // SAVE
  // =======================================================

  try {

    await update(
      ref(db),
      updates
    );

  } catch (error) {

    console.error(
      "Phase update failed:",
      error
    );

    throw error;
  }

  // =======================================================
  // CHECK WIN CONDITION
  // =======================================================

  if (
    nextPhase === "DAWN" ||
    nextPhase === "NIGHT"
  ) {

    await checkWinCondition();
  }
}

// =========================================================
// WIN CONDITION
// =========================================================

async function checkWinCondition() {

  try {

    const snap =
      await get(
        ref(db, `rooms/${myRoomCode}`)
      );

    if (!snap.exists()) {
      return;
    }

    const data = snap.val();

    if (data.gameState.winner) {
      return;
    }

    let aliveMafia = 0;
    let aliveVillage = 0;

    Object.values(
      data.players || {}
    ).forEach(
      (p) => {

        if (!p.isAlive) {
          return;
        }

        if (
          p.role === "Mafia" || p.role === "Silent Mafia"
        ) {

          aliveMafia++;

        } else if (p.role !== "Fool") {

          aliveVillage++;
        }
      }
    );

    let winner = null;

    if (
      aliveMafia === 0
    ) {

      winner = "VILLAGE";

    } else if (
      aliveMafia >= aliveVillage
    ) {

      winner = "MAFIA";
    }

    if (winner) {

      await update(
        ref(db),
        {

          [`rooms/${myRoomCode}/gameState/winner`]:
            winner,

          [`rooms/${myRoomCode}/gameState/phase`]:
            "GAME_OVER",

          [`rooms/${myRoomCode}/logs/announcement`]:
            `${winner} WINS THE GAME!`
        }
      );

      playPhaseAudio("LOBBY");
    }

  } catch (error) {

    console.error(
      "Win condition check failed:",
      error
    );
  }
}

// =========================================================
// PLAYER LOGIC
// =========================================================

function updatePlayerUI(data) {

  const me =
    playersCache[myPlayerId];

  if (!me) {

    alert(
      "You have been removed from the room by the host."
    );

    clearSession();

    return;
  }

  el("player-name-display").innerText =
    me.name;

  el("player-phase-display").innerText =
    data.gameState.phase;

  // -----------------------------------------
  // Role
  // -----------------------------------------

  if (me.role) {

    myRoleData =
      ROLES[me.role] || (me.role === "Silent Mafia" ? { team: "Mafia", desc: "You were recruited into the Mafia and revived as a silent member. You have no active night abilities.", win: "Reach parity with the living village." } : {});

    if (myRoleData) {

      el("role-name").innerText =
        me.role;

      el("role-desc").innerText =
        myRoleData.desc;

      el("role-win").innerText =
        myRoleData.win;
    }
  }

  const select =
    el("target-select");

  const btn =
    el("btn-submit-action");

  const prompt =
    el("action-prompt");

  const feedback =
    el("action-feedback");

  const deadContainer =
    el("player-dead-container");

  const deadList =
    el("player-dead-list");

  // -----------------------------------------
  // Reset UI
  // -----------------------------------------

  select.classList.add("hidden");
  btn.classList.add("hidden");
  feedback.classList.add("hidden");

  // Remove extra dynamic controls if any exist from previous renders
  const existingRecruitSelect = document.getElementById("recruit-target-select");
  if (existingRecruitSelect) existingRecruitSelect.remove();
  const existingRecruitPrompt = document.getElementById("recruit-prompt-container");
  if (existingRecruitPrompt) existingRecruitPrompt.remove();

  // -----------------------------------------
  // Dead players
  // -----------------------------------------

  deadList.innerHTML = "";

  let deadCount = 0;

  Object.entries(playersCache).forEach(
    ([id, p]) => {

      if (!p.isAlive) {

        deadCount++;

        deadList.innerHTML +=
          `<li>${p.name}</li>`;
      }
    }
  );

  if (deadCount > 0) {

    deadContainer.classList.remove(
      "hidden"
    );

  } else {

    deadContainer.classList.add(
      "hidden"
    );
  }

  // -----------------------------------------
  // Dead player
  // -----------------------------------------

  if (!me.isAlive) {

    prompt.innerText =
      "You are DEAD. Please remain quiet.";

    return;
  }

  // -----------------------------------------
  // Game over
  // -----------------------------------------

  if (data.gameState.winner) {

    prompt.innerText =
      `Game Over. ${data.gameState.winner} wins.`;

    return;
  }

  // Check for pending recruitment request
  if (data.gameState.phase === "NIGHT" && me.pendingRecruitment) {
    prompt.innerText = "The Mafia wants to recruit you!";
    
    const recruitContainer = document.createElement("div");
    recruitContainer.id = "recruit-prompt-container";
    recruitContainer.style.margin = "10px 0";
    
    const acceptBtn = document.createElement("button");
    acceptBtn.innerText = "Accept";
    acceptBtn.style.marginRight = "10px";
    acceptBtn.onclick = async () => {
      await update(ref(db, `rooms/${myRoomCode}/players/${myPlayerId}`), {
        role: "Mafia",
        wasRecruited: true,
        pendingRecruitment: false,
        nightTarget: "sleep"
      });
    };

    const declineBtn = document.createElement("button");
    declineBtn.innerText = "Decline";
    declineBtn.onclick = async () => {
      await update(ref(db, `rooms/${myRoomCode}/players/${myPlayerId}`), {
        pendingRecruitment: false,
        nightTarget: "sleep"
      });
    };

    recruitContainer.appendChild(acceptBtn);
    recruitContainer.appendChild(declineBtn);
    prompt.appendChild(recruitContainer);
    return;
  }

  // -----------------------------------------
  // Target options
  // -----------------------------------------

  select.innerHTML =
    '<option value="">-- Select Target --</option>';

  Object.entries(playersCache).forEach(
    ([id, p]) => {

      if (data.gameState.phase === "NIGHT") {

        if (
          me.role === "Reviver" &&
          !me.perks.abilityUsed
        ) {
          if (!p.isAlive) {
            select.innerHTML +=
              `<option value="${id}">${p.name}</option>`;
          }

          return;
        }

        if (p.isAlive) {

          if (
            id !== myPlayerId ||
            me.role === "Doctor"
          ) {
            const selfTag =
              id === myPlayerId
                ? " (Yourself)"
                : "";

            select.innerHTML +=
              `<option value="${id}">${p.name}${selfTag}</option>`;
          }
        }

        return;
      }

      if (data.gameState.phase === "DAY_VOTE") {

        if (
          p.isAlive &&
          id !== myPlayerId
        ) {
          select.innerHTML +=
            `<option value="${id}">${p.name}</option>`;
        }
      }
    }
  );

  // =======================================================
  // NIGHT
  // =======================================================

  if (
    data.gameState.phase === "NIGHT"
  ) {

    // Show partner info for Mafia / Farmer via private log or UI
    let teamInfoText = "";
    if (me.role === "Mafia" || me.role === "Silent Mafia") {
      let partners = [];
      let farmerName = "";
      Object.values(playersCache).forEach(p => {
        if (p.isAlive) {
          if ((p.role === "Mafia" || p.role === "Silent Mafia") && p.name !== me.name) partners.push(p.name);
          if (p.role === "Farmer") farmerName = p.name;
        }
      });
      if (partners.length > 0) teamInfoText += ` Fellow Mafia: ${partners.join(", ")}.`;
      if (farmerName) teamInfoText += ` Farmer: ${farmerName}.`;
    } else if (me.role === "Farmer") {
      let mafiaNames = [];
      Object.values(playersCache).forEach(p => {
        if (p.isAlive && (p.role === "Mafia" || p.role === "Silent Mafia")) mafiaNames.push(p.name);
      });
      if (mafiaNames.length > 0) teamInfoText += ` Mafia partners: ${mafiaNames.join(", ")}.`;
    }

    if (me.nightTarget) {

      prompt.innerText =
        `Action locked in. Waiting for others.${teamInfoText}`;
    }

    else if (

      [
        "Fool",
        "Mayor",
        "Villager",
        "Silent Mafia"
      ].includes(me.role)

      ||

      (
        me.role === "Jailor" &&
        me.perks.bulletUsed
      )

      ||

      (
        me.role === "Snatcher" &&
        me.perks.abilityUsed
      )

      ||

      (
        me.role === "Reviver" &&
        (
          me.perks.abilityUsed ||
          deadCount === 0
        )
      )

      ||

      (
        me.role === "Farmer" &&
        me.perks.abilityUsed
      )
    ) {

      prompt.innerText =
        `You have no action tonight. Sleep.${teamInfoText}`;

      btn.innerText =
        "Go to Sleep";

      btn.classList.remove(
        "hidden"
      );

      btn.onclick = () => {

        setAction(
          "nightTarget",
          "sleep"
        );

      };

    }

    // Active role
    else {

      prompt.innerText =
        (me.role === "Reviver"
          ? "Choose a player to revive:"
          : me.role === "Mafia"
          ? "Choose your kill target:"
          : me.role === "Farmer"
          ? "Choose a player to frame:"
          : "Choose your night target:") + teamInfoText;

      if (me.role === "Mafia") {
        // Add recruitment dropdown if not used and living mafia count < 2
        let livingMafiaCount = 0;
        Object.values(playersCache).forEach(p => {
          if (p.isAlive && (p.role === "Mafia" || p.role === "Silent Mafia")) livingMafiaCount++;
        });

        if (!me.perks.abilityUsed && livingMafiaCount < 2) {
          const recruitSelect = document.createElement("select");
          recruitSelect.id = "recruit-target-select";
          recruitSelect.innerHTML = '<option value="none">-- Optional: Recruit Player --</option>';
          Object.entries(playersCache).forEach(([id, p]) => {
            if (p.isAlive && p.role !== "Farmer" && id !== myPlayerId) {
              recruitSelect.innerHTML += `<option value="${id}">${p.name}</option>`;
            }
          });
          select.parentNode.insertBefore(recruitSelect, select.nextSibling);
        }
      }

      // Farmer retains sleep option here
      if (
        [
          "Jailor",
          "Snatcher",
          "Reviver",
          "Farmer"
        ].includes(me.role)
      ) {

        select.innerHTML +=
          `<option value="sleep">Skip / Sleep</option>`;
      }

      select.classList.remove(
        "hidden"
      );

      btn.innerText =
        "Confirm Action";

      btn.classList.remove(
        "hidden"
      );

      btn.onclick = async () => {

        if (!select.value) {
          return;
        }

        if (me.role === "Mafia") {
          const recruitSel = document.getElementById("recruit-target-select");
          if (recruitSel && recruitSel.value && recruitSel.value !== "none") {
            await set(ref(db, `rooms/${myRoomCode}/players/${myPlayerId}/recruitTarget`), recruitSel.value);
          } else {
            await set(ref(db, `rooms/${myRoomCode}/players/${myPlayerId}/recruitTarget`), "none");
          }
        }

        if (me.role === "Farmer" && select.value !== "sleep") {
          await set(ref(db, `rooms/${myRoomCode}/players/${myPlayerId}/perks/abilityUsed`), true);
        }

        setAction(
          "nightTarget",
          select.value
        );
      };
    }

  }

  // =======================================================
  // DAY VOTE
  // =======================================================

  else if (
    data.gameState.phase === "DAY_VOTE"
  ) {

    if (me.voteTarget) {

      if (
        me.voteTarget === "skip"
      ) {

        prompt.innerText =
          "You voted to skip. Waiting for others.";

      } else {

        const target =
          playersCache[me.voteTarget];

        prompt.innerText =
          target
            ? `You voted for ${target.name}. Waiting for others.`
            : "Vote cast. Waiting for others.";
      }

    }

    else {

      prompt.innerText =
        "Cast your vote to eliminate:";

      select.innerHTML +=
        `<option value="skip">Skip Vote</option>`;

      select.classList.remove(
        "hidden"
      );

      btn.innerText =
        "Submit Vote";

      btn.classList.remove(
        "hidden"
      );

      btn.onclick = () => {

        if (!select.value) {
          return;
        }

        setAction(
          "voteTarget",
          select.value
        );
      };
    }

  }

  else {

    prompt.innerText =
      "Discuss with the town.";
  }

  // =======================================================
  // PRIVATE LOGS
  // =======================================================

  if (
    me.privateLogs &&
    me.privateLogs.length > 0
  ) {

    el("player-private-logs")
      .classList.remove("hidden");

    el("private-log-list").innerHTML =
      me.privateLogs
        .map(
          (l) => `<li>${l}</li>`
        )
        .join("");

  } else {

    el("player-private-logs")
      .classList.add("hidden");
  }
}

// =========================================================
// SET ACTION
// =========================================================

async function setAction(
  field,
  value
) {

  if (
    !myRoomCode ||
    !myPlayerId
  ) {
    return;
  }

  try {

    await set(
      ref(
        db,
        `rooms/${myRoomCode}/players/${myPlayerId}/${field}`
      ),
      value
    );

  } catch (error) {

    console.error(
      "Action submission failed:",
      error
    );
  }
}

// =========================================================
// RESTART GAME
// =========================================================

el("btn-restart-game").onclick =
  async () => {

    const updates = {

      [`rooms/${myRoomCode}/gameState`]: {
        phase: "LOBBY",
        round: 1,
        winner: null
      },

      [`rooms/${myRoomCode}/logs/announcement`]:
        "Lobby restarted."
    };

    Object.keys(
      playersCache
    ).forEach(
      (id) => {

        updates[
          `rooms/${myRoomCode}/players/${id}/isAlive`
        ] = true;

        updates[
          `rooms/${myRoomCode}/players/${id}/role`
        ] = "";

        updates[
          `rooms/${myRoomCode}/players/${id}/nightTarget`
        ] = null;

        updates[
          `rooms/${myRoomCode}/players/${id}/recruitTarget`
        ] = null;

        updates[
          `rooms/${myRoomCode}/players/${id}/voteTarget`
        ] = null;

        updates[
          `rooms/${myRoomCode}/players/${id}/pendingRecruitment`
        ] = false;

        updates[
          `rooms/${myRoomCode}/players/${id}/wasRecruited`
        ] = null;

        updates[
          `rooms/${myRoomCode}/players/${id}/privateLogs`
        ] = [];

        updates[
          `rooms/${myRoomCode}/players/${id}/perks`
        ] = {
          bulletUsed: false,
          abilityUsed: false
        };
      }
    );

    try {

      await update(
        ref(db),
        updates
      );

      isAdvancing = false;
      phaseTransitionInProgress = false;

    } catch (error) {

      console.error(
        "Restart failed:",
        error
      );

      alert(
        "Could not restart game."
      );
    }
  };

// =========================================================
// LEAVE ROOM
// =========================================================

el("btn-leave-room").onclick =
  async () => {

    if (
      confirm(
        "Are you sure you want to leave the game?"
      )
    ) {

      try {

        if (
          myRoomCode &&
          myPlayerId
        ) {

          await set(
            ref(
              db,
              `rooms/${myRoomCode}/players/${myPlayerId}`
            ),
            null
          );
        }

      } catch (error) {

        console.error(
          "Leave failed:",
          error
        );
      }

      clearSession();
    }
  };

// =========================================================
// CLOSE ROOM
// =========================================================

el("btn-close-room").onclick =
  async () => {

    if (
      confirm(
        "Close this room? All players will be kicked back to the main menu."
      )
    ) {

      try {

        if (myRoomCode) {

          await set(
            ref(
              db,
              `rooms/${myRoomCode}`
            ),
            null
          );
        }

      } catch (error) {

        console.error(
          "Close room failed:",
          error
        );
      }

      clearSession();
    }
  };
