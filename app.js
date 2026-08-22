import { initializeApp } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-app.js";
import { getDatabase, ref, set, get, onValue, update } from "https://www.gstatic.com/firebasejs/10.4.0/firebase-database.js";

// --- PASTE YOUR FIREBASE CONFIG HERE ---
const firebaseConfig = {
    apiKey: "AIzaSyDgg2Qzog5V-M2-LEb0Oigllli1he1le3o",
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

// --- STATE ---
let isHost = false;
let myRoomCode = localStorage.getItem('roomCode') || null;
let myPlayerId = localStorage.getItem('playerId') || null;
let playersCache = {};
let currentPhase = "";
let myRoleData = {};

// --- ROLE ROSTER ---
const ROLES = {
  Mafia: { team: "Mafia", desc: "You are the lone imposter. Each night, choose one player to eliminate. Blend in during the day.", win: "Reach parity with the living village." },
  Fool: { team: "Neutral", desc: "You have no night powers. Act suspicious and convince the town to vote you out.", win: "Get voted out during Daytime voting." },
  Doctor: { team: "Village", desc: "Choose one player each night to protect from the Mafia's attack.", win: "Eliminate the Mafia." },
  Detective: { team: "Village", desc: "Investigate one player each night to learn if they are 'Mafia' or 'Not Mafia'.", win: "Eliminate the Mafia." },
  Jailor: { team: "Village", desc: "You have 1 bullet for the entire game. Shoot a suspect at night.", win: "Eliminate the Mafia.", perk: true },
  Barman: { team: "Village", desc: "Distract one player each night. Their night action fails.", win: "Eliminate the Mafia." },
  Bodyguard: { team: "Village", desc: "Guard one player each night. If attacked, they survive and you die instead.", win: "Eliminate the Mafia." },
  Lookout: { team: "Village", desc: "Watch one player each night to see if anyone visited them.", win: "Eliminate the Mafia." },
  Mayor: { team: "Village", desc: "Your vote during daytime secretly counts as 2 votes.", win: "Eliminate the Mafia." },
  Villager: { team: "Village", desc: "You have no night abilities. Use daytime logic to find the Mafia.", win: "Eliminate the Mafia." }
};

// --- DOM ELEMENTS ---
const switchView = (id) => { document.querySelectorAll('.view').forEach(v => v.classList.remove('active')); document.getElementById(id).classList.add('active'); };
const el = (id) => document.getElementById(id);

// --- INIT / RECONNECT ---
window.onload = async () => {
  if (myRoomCode && myPlayerId) {
    const pSnap = await get(ref(db, `rooms/${myRoomCode}/players/${myPlayerId}`));
    if (pSnap.exists()) {
      isHost = false;
      listenToRoom(myRoomCode);
      switchView('view-player');
    } else {
      clearSession();
    }
  }
};

const clearSession = () => { localStorage.removeItem('roomCode'); localStorage.removeItem('playerId'); myRoomCode = null; myPlayerId = null; switchView('view-menu'); };

// --- MENU ACTIONS ---
el('btn-create-room').onclick = async () => {
  myRoomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
  isHost = true;
  await set(ref(db, `rooms/${myRoomCode}`), {
    gameState: { phase: "LOBBY", round: 1, winner: null },
    players: {},
    logs: { announcement: "Waiting for players to join..." }
  });
  el('host-room-code').innerText = myRoomCode;
  listenToRoom(myRoomCode);
  switchView('view-host');
};

el('btn-join-room').onclick = async () => {
  const code = el('join-room-code').value.toUpperCase();
  const name = el('join-nickname').value.trim();
  if (code.length !== 4 || !name) return alert("Enter valid code and name.");
  
  const roomSnap = await get(ref(db, `rooms/${code}`));
  if (!roomSnap.exists()) return alert("Room not found.");
  if (roomSnap.val().gameState.phase !== "LOBBY") return alert("Game already in progress.");

  myPlayerId = `p_${Date.now()}`;
  myRoomCode = code;
  localStorage.setItem('roomCode', myRoomCode);
  localStorage.setItem('playerId', myPlayerId);
  
  await set(ref(db, `rooms/${myRoomCode}/players/${myPlayerId}`), {
    name, role: "", isAlive: true, nightTarget: null, voteTarget: null, privateLogs: [], perks: { bulletUsed: false }
  });
  
  listenToRoom(myRoomCode);
  switchView('view-player');
};

// --- REALTIME LISTENER ---
function listenToRoom(roomCode) {
  onValue(ref(db, `rooms/${roomCode}`), (snapshot) => {
    const data = snapshot.val();
    
    // If room is deleted (host closed it)
    if (!data) {
      if (!isHost) alert("The host has closed this room.");
      return clearSession();
    }
    
    playersCache = data.players || {};
    currentPhase = data.gameState.phase;
    
    if (isHost) updateHostUI(data);
    else updatePlayerUI(data);
  });
}

// --- HOST LOGIC ---
function updateHostUI(data) {
  el('host-phase').innerText = data.gameState.phase;
  el('host-announcements').innerText = data.logs.announcement;
  
  let aliveCount = 0;
  el('host-alive-list').innerHTML = "";
  el('host-dead-list').innerHTML = "";
  
  Object.entries(playersCache).forEach(([id, p]) => {
    const li = document.createElement('li');
    li.style.display = "flex";
    li.style.justifyContent = "space-between";
    li.style.alignItems = "center";
    
    const textSpan = document.createElement('span');
    textSpan.innerText = `${p.name} ${data.gameState.phase !== 'LOBBY' && p.role ? `(${p.role})` : ''}`;
    li.appendChild(textSpan);

    // Dynamic Kick Button
    const kickBtn = document.createElement('button');
    kickBtn.innerText = "KICK";
    kickBtn.style.padding = "4px 8px";
    kickBtn.style.width = "auto";
    kickBtn.style.fontSize = "0.7rem";
    kickBtn.onclick = async () => {
      if (confirm(`Are you sure you want to remove ${p.name} from the game?`)) {
        await set(ref(db, `rooms/${myRoomCode}/players/${id}`), null);
      }
    };
    li.appendChild(kickBtn);

    if (p.isAlive) { aliveCount++; el('host-alive-list').appendChild(li); } 
    else { el('host-dead-list').appendChild(li); }
  });
  el('host-alive-count').innerText = aliveCount;
  
  // Toggle Start vs Advance buttons based on phase
  const btnStart = el('btn-start-game');
  const btnAdvance = el('btn-advance-phase');

  if (data.gameState.phase === "LOBBY") {
    btnStart.classList.remove('hidden');
    btnAdvance.classList.add('hidden');
  } else {
    btnStart.classList.add('hidden');
    btnAdvance.classList.remove('hidden');
  }

  if(data.gameState.winner) { btnAdvance.disabled = true; return; }
  btnAdvance.disabled = false;
  const phaseFlow = { "LOBBY": "NIGHT", "NIGHT": "DAWN", "DAWN": "DAY_VOTE", "DAY_VOTE": "NIGHT" };
  btnAdvance.innerText = `Advance to ${phaseFlow[currentPhase] || 'NIGHT'}`;
  btnAdvance.onclick = () => advancePhase(phaseFlow[currentPhase]);
}

el('btn-start-game').onclick = () => {
  const pKeys = Object.keys(playersCache);
  if (pKeys.length < 6 || pKeys.length > 9) return alert("Need 6 to 9 players.");
  
  // Assign Roles
  let pool = ["Fool", "Doctor", "Detective", "Jailor", "Barman", "Bodyguard", "Lookout", "Mayor", "Villager", "Villager"];
  pool = pool.sort(() => 0.5 - Math.random()).slice(0, pKeys.length - 1);
  pool.push("Mafia");
  pool = pool.sort(() => 0.5 - Math.random());
  
  const updates = {};
  pKeys.forEach((key, i) => { updates[`rooms/${myRoomCode}/players/${key}/role`] = pool[i]; });
  updates[`rooms/${myRoomCode}/gameState/phase`] = "NIGHT";
  updates[`rooms/${myRoomCode}/logs/announcement`] = "Night falls. Check your devices.";
  update(ref(db), updates);
};

// --- STRICT NIGHT RESOLUTION ---
async function advancePhase(nextPhase) {
  const updates = { [`rooms/${myRoomCode}/gameState/phase`]: nextPhase };
  
  if (nextPhase === "DAWN") {
    // 1. Resolve Actions
    let actions = {}; 
    let deaths = [];
    let logs = {};
    
    // Extract actions
    Object.entries(playersCache).forEach(([id, p]) => {
      if (p.isAlive && p.nightTarget) actions[p.role] = { actor: id, target: p.nightTarget };
    });

    // A. Barman Block
    const blockedPlayerId = actions["Barman"] ? actions["Barman"].target : null;
    let blockedRole = null;
    if (blockedPlayerId && playersCache[blockedPlayerId]) blockedRole = playersCache[blockedPlayerId].role;

    // Remove blocked action
    if (blockedRole && actions[blockedRole]) delete actions[blockedRole];

    // B. Protections
    const docTarget = actions["Doctor"] ? actions["Doctor"].target : null;
    const bgTarget = actions["Bodyguard"] ? actions["Bodyguard"].target : null;

    // C. Jailor Shot
    if (actions["Jailor"]) {
      const target = actions["Jailor"].target;
      if (target !== docTarget) deaths.push(target);
      updates[`rooms/${myRoomCode}/players/${actions["Jailor"].actor}/perks/bulletUsed`] = true;
    }

    // D. Mafia Attack
    if (actions["Mafia"]) {
      const target = actions["Mafia"].target;
      if (target === docTarget) {
        // Doc saves
      } else if (target === bgTarget) {
        if (docTarget === actions["Bodyguard"].actor) {
           // BG takes hit, but Doc saves BG
        } else {
           deaths.push(actions["Bodyguard"].actor); // BG dies
        }
      } else {
        deaths.push(target);
      }
    }

    // E. Intel (Detective / Lookout)
    if (actions["Detective"]) {
      const target = actions["Detective"].target;
      const isMafia = playersCache[target].role === "Mafia";
      logs[actions["Detective"].actor] = `${playersCache[target].name} is ${isMafia ? 'MAFIA' : 'NOT MAFIA'}.`;
    }
    if (actions["Lookout"]) {
      const target = actions["Lookout"].target;
      let visitors = 0;
      Object.values(actions).forEach(a => { if (a.target === target) visitors++; });
      logs[actions["Lookout"].actor] = `${visitors} people visited ${playersCache[target].name}.`;
    }

    // Apply Deaths & Logs
    const uniqueDeaths = [...new Set(deaths)];
    uniqueDeaths.forEach(dId => { updates[`rooms/${myRoomCode}/players/${dId}/isAlive`] = false; });
    Object.entries(logs).forEach(([id, msg]) => { updates[`rooms/${myRoomCode}/players/${id}/privateLogs`] = [msg]; });
    
    const deadNames = uniqueDeaths.map(id => playersCache[id].name).join(", ");
    updates[`rooms/${myRoomCode}/logs/announcement`] = deadNames ? `The village wakes to find ${deadNames} murdered.` : "The village wakes peacefully. No one died.";
    
    // Clear targets
    Object.keys(playersCache).forEach(id => { updates[`rooms/${myRoomCode}/players/${id}/nightTarget`] = null; });
  }

  if (nextPhase === "NIGHT") {
    // Resolve Day Vote
    let votes = {};
    Object.values(playersCache).forEach(p => {
      if (p.isAlive && p.voteTarget) {
        let weight = p.role === "Mayor" ? 2 : 1;
        votes[p.voteTarget] = (votes[p.voteTarget] || 0) + weight;
      }
    });
    
    // Find majority
    let maxVotes = 0;
    let executed = null;
    Object.entries(votes).forEach(([target, v]) => {
      if (v > maxVotes) { maxVotes = v; executed = target; }
      else if (v === maxVotes) { executed = null; } // Tie
    });

    if (executed) {
      updates[`rooms/${myRoomCode}/players/${executed}/isAlive`] = false;
      updates[`rooms/${myRoomCode}/logs/announcement`] = `${playersCache[executed].name} was voted out.`;
      
      if (playersCache[executed].role === "Fool") {
        updates[`rooms/${myRoomCode}/gameState/winner`] = "FOOL";
      }
    } else {
      updates[`rooms/${myRoomCode}/logs/announcement`] = "The village tied. Nobody was executed.";
    }
    
    // Clear votes
    Object.keys(playersCache).forEach(id => { updates[`rooms/${myRoomCode}/players/${id}/voteTarget`] = null; });
  }

  await update(ref(db), updates);
  if(nextPhase === "DAWN" || nextPhase === "NIGHT") checkWinCondition();
}

async function checkWinCondition() {
  const snap = await get(ref(db, `rooms/${myRoomCode}`));
  const data = snap.val();
  if (data.gameState.winner) return; // Fool already won

  let aliveMafia = 0;
  let aliveVillage = 0;
  Object.values(data.players).forEach(p => {
    if (p.isAlive) {
      if (p.role === "Mafia") aliveMafia++;
      else aliveVillage++;
    }
  });

  let winner = null;
  if (aliveMafia === 0) winner = "VILLAGE";
  else if (aliveMafia >= aliveVillage) winner = "MAFIA";

  if (winner) {
    await update(ref(db), { 
      [`rooms/${myRoomCode}/gameState/winner`]: winner,
      [`rooms/${myRoomCode}/gameState/phase`]: "GAME_OVER",
      [`rooms/${myRoomCode}/logs/announcement`]: `${winner} WINS THE GAME!`
    });
  }
}

// --- PLAYER LOGIC ---
function updatePlayerUI(data) {
  const me = playersCache[myPlayerId];
  
  // Detection for being Kicked by Host
  if (!me) {
    alert("You have been removed from the room by the host.");
    clearSession();
    return;
  }
  
  el('player-name-display').innerText = me.name;
  el('player-phase-display').innerText = data.gameState.phase;
  
  if (me.role) {
    myRoleData = ROLES[me.role];
    el('role-name').innerText = me.role;
    el('role-desc').innerText = myRoleData.desc;
    el('role-win').innerText = myRoleData.win;
  }

  // Handle Action UI
  const actionArea = el('player-action-area');
  const select = el('target-select');
  const btn = el('btn-submit-action');
  const prompt = el('action-prompt');
  const feedback = el('action-feedback');
  
  select.classList.add('hidden');
  btn.classList.add('hidden');
  feedback.classList.add('hidden');

  if (!me.isAlive) {
    prompt.innerText = "You are DEAD. Please remain quiet.";
    return;
  }

  if (data.gameState.winner) {
    prompt.innerText = `Game Over. ${data.gameState.winner} wins.`;
    return;
  }

  // Populate Targets
  select.innerHTML = '<option value="">-- Select Target --</option>';
  Object.entries(playersCache).forEach(([id, p]) => {
    if (p.isAlive && id !== myPlayerId) {
      select.innerHTML += `<option value="${id}">${p.name}</option>`;
    }
  });

  if (data.gameState.phase === "NIGHT") {
    if (me.nightTarget) {
      prompt.innerText = "Action locked in. Waiting for others.";
    } else if (["Fool", "Mayor", "Villager"].includes(me.role) || (me.role === "Jailor" && me.perks.bulletUsed)) {
      prompt.innerText = "You have no action tonight. Sleep.";
      btn.innerText = "Go to Sleep";
      btn.classList.remove('hidden');
      btn.onclick = () => setAction('nightTarget', 'sleep');
    } else {
      prompt.innerText = "Choose your night target:";
      select.classList.remove('hidden');
      btn.innerText = "Confirm Action";
      btn.classList.remove('hidden');
      btn.onclick = () => {
        if (!select.value) return;
        setAction('nightTarget', select.value);
      };
    }
  } else if (data.gameState.phase === "DAY_VOTE") {
    if (me.voteTarget) {
      prompt.innerText = "Vote cast. Waiting for others.";
    } else {
      prompt.innerText = "Cast your vote to eliminate:";
      select.innerHTML += `<option value="skip">Skip Vote</option>`;
      select.classList.remove('hidden');
      btn.innerText = "Submit Vote";
      btn.classList.remove('hidden');
      btn.onclick = () => {
        if (!select.value) return;
        setAction('voteTarget', select.value);
      };
    }
  } else {
    prompt.innerText = "Discuss with the town.";
  }

  // Private Logs
  if (me.privateLogs && me.privateLogs.length > 0) {
    el('player-private-logs').classList.remove('hidden');
    el('private-log-list').innerHTML = me.privateLogs.map(l => `<li>${l}</li>`).join('');
  } else {
    el('player-private-logs').classList.add('hidden');
  }
}

async function setAction(field, value) {
  await set(ref(db, `rooms/${myRoomCode}/players/${myPlayerId}/${field}`), value);
}

el('btn-restart-game').onclick = async () => {
  const updates = { 
    [`rooms/${myRoomCode}/gameState`]: { phase: "LOBBY", round: 1, winner: null },
    [`rooms/${myRoomCode}/logs/announcement`]: "Lobby restarted."
  };
  Object.keys(playersCache).forEach(id => {
    updates[`rooms/${myRoomCode}/players/${id}/isAlive`] = true;
    updates[`rooms/${myRoomCode}/players/${id}/role`] = "";
    updates[`rooms/${myRoomCode}/players/${id}/nightTarget`] = null;
    updates[`rooms/${myRoomCode}/players/${id}/voteTarget`] = null;
    updates[`rooms/${myRoomCode}/players/${id}/privateLogs`] = [];
    updates[`rooms/${myRoomCode}/players/${id}/perks`] = { bulletUsed: false };
  });
  await update(ref(db), updates);
};

// --- LEAVE / CLOSE ROOM LOGIC ---
el('btn-leave-room').onclick = async () => {
  if (confirm("Are you sure you want to leave the game?")) {
    if (myRoomCode && myPlayerId) {
      await set(ref(db, `rooms/${myRoomCode}/players/${myPlayerId}`), null);
    }
    clearSession();
  }
};

el('btn-close-room').onclick = async () => {
  if (confirm("Close this room? All players will be kicked back to the main menu.")) {
    if (myRoomCode) {
      await set(ref(db, `rooms/${myRoomCode}`), null);
    }
    clearSession();
  }
};
