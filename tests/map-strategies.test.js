const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
require("../map-strategies.js");

const { createDefaultState, evaluate, getMissingInfo, normalizeState } = globalThis.HotsMapStrategies;
const favorable = {
  oursAlive: 5,
  enemyAlive: 3,
  enemyPossibleAlive: 3,
  confirmedRallyAdvantage: true,
  levelDisadvantage: false,
  objectiveActive: true,
  objectivePhase: "waiting",
  objectiveSeconds: 30,
  severeSurvivalRisk: false
};
const unfavorable = {
  ...favorable,
  oursAlive: 2,
  enemyAlive: 4,
  enemyPossibleAlive: 4,
  confirmedRallyAdvantage: false
};

function loadCoachHarness() {
  let now = Date.now();
  const intervals = [];
  class TestDate extends Date {
    static now() { return now; }
  }
  class Element {
    constructor() {
      Object.assign(this, {
        value: "", textContent: "", innerHTML: "", hidden: false, disabled: false,
        checked: false, dataset: {}, listeners: {}, validity: { badInput: false }, classList: { add() {}, remove() {} }
      });
    }
    addEventListener(type, callback) { this.listeners[type] = callback; }
    querySelector() { return new Element(); }
    querySelectorAll() { return []; }
    replaceChildren() {}
    append() {}
    insertAdjacentHTML() {}
    setCustomValidity() {}
    reportValidity() {}
    close() { this.open = false; }
    showModal() { this.open = true; }
    focus() {}
    setAttribute(name, value) { this.attributes ??= {}; this.attributes[name] = value; }
    scrollIntoView() {}
  }
  const elements = new Map();
  const querySelector = (selector) => {
    if (!elements.has(selector)) elements.set(selector, new Element());
    return elements.get(selector);
  };
  const document = {
    querySelector,
    querySelectorAll: () => [],
    createElement: () => new Element(),
    activeElement: null,
    body: { style: { setProperty() {}, removeProperty() {} } }
  };
  let confirmResult = true;
  let confirmCalls = 0;
  const window = {
    setInterval(callback) { intervals.push(callback); },
    confirm() { confirmCalls += 1; return confirmResult; },
    scrollTo() {}
  };
  const storage = { value: null, getItem: () => null, setItem(_key, value) { this.value = value; } };
  const context = {
    document,
    window,
    localStorage: storage,
    console,
    Date: TestDate
  };
  const root = path.join(__dirname, "..");
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "map-strategies.js"), "utf8"), context);
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(inlineScript, "page has an inline application script");
  const hook = `window.__coachTest = { defaultState, getState: () => state, setState: (next) => { state = next; }, makeRecommendation, normalizeState, renderObjectiveTimer, respawnSecondsRemaining, updateRespawnCountdowns, teamSurvival };
        loadState();`;
  const instrumented = inlineScript.replace("        loadState();", hook);
  assert.notEqual(instrumented, inlineScript, "test hook insertion point exists");
  vm.runInContext(instrumented, context, { filename: "index.html" });
  return {
    coach: window.__coachTest,
    querySelector,
    storage,
    now: () => now,
    setTime(value) { now = value; },
    runIntervals() { for (const callback of intervals) callback(); },
    setConfirmResult(value) { confirmResult = value; },
    getConfirmCalls() { return confirmCalls; }
  };
}

test("Cursed Hollow changes from ordinary objective handling to third-tribute contest", () => {
  const state = createDefaultState();
  state["저주받은 골짜기"] = { oursTributes: 0, enemyTributes: 0, curseStatus: "none" };
  assert.equal(evaluate("저주받은 골짜기", state, favorable), null);

  state["저주받은 골짜기"].oursTributes = 2;
  const recommendation = evaluate("저주받은 골짜기", state, favorable);
  assert.match(recommendation.action, /세 번째 공물 경합/);
  assert.match(recommendation.expectedBenefit, /70초 저주/);

  const losingSituation = evaluate("저주받은 골짜기", state, unfavorable);
  assert.match(losingSituation.action, /경합을 보류/);
  assert.match(losingSituation.warning, /공물 수만으로 교전을 강제하지 않습니다/);
});

test("Cursed Hollow recommends defending when the enemy is one tribute from a curse", () => {
  const state = createDefaultState();
  state["저주받은 골짜기"] = { oursTributes: 0, enemyTributes: 2, curseStatus: "none" };
  const recommendation = evaluate("저주받은 골짜기", state, unfavorable);
  assert.match(recommendation.action, /저주 방어/);
});

test("a level deficit alone does not cancel a contest supported by confirmed numbers", () => {
  const state = createDefaultState();
  state["저주받은 골짜기"] = { oursTributes: 2, enemyTributes: 0, curseStatus: "none" };
  const recommendation = evaluate("저주받은 골짜기", state, {
    ...favorable,
    oursAlive: 4,
    enemyPossibleAlive: 4,
    confirmedRallyAdvantage: false,
    levelDisadvantage: true
  });
  assert.match(recommendation.action, /세 번째 공물 경합을 준비/);
});

test("Towers of Doom values altars differently based on bell tower ownership", () => {
  const state = createDefaultState();
  state["파멸의 탑"] = { oursBellTowers: 5, enemyBellTowers: 1 };
  const leading = evaluate("파멸의 탑", state, favorable);
  assert.match(leading.action, /종탑 우위.*제단/);

  state["파멸의 탑"] = { oursBellTowers: 1, enemyBellTowers: 5 };
  const trailing = evaluate("파멸의 탑", state, unfavorable);
  assert.match(trailing.action, /제단 경합보다 안전한 종탑 탈환/);

  const changedTowers = evaluate(
    "파멸의 탑",
    { ...createDefaultState(), "파멸의 탑": { oursBellTowers: 1, enemyBellTowers: 5 } },
    favorable
  );
  assert.match(changedTowers.action, /제단과 종탑 중 안전하게 지킬 목표/);
});

test("Dragon Shire distinguishes unlocked and locked altar states", () => {
  const state = createDefaultState();
  state["용의 둥지"] = { topShrine: "ours", bottomShrine: "ours" };
  const ready = evaluate("용의 둥지", state, favorable);
  assert.match(ready.action, /중앙 제단에서 용기사/);

  state["용의 둥지"] = { topShrine: "enemy", bottomShrine: "enemy" };
  const giveUp = evaluate("용의 둥지", state, unfavorable);
  assert.match(giveUp.action, /중앙 교전을 피하고/);

  state["용의 둥지"] = { topShrine: "ours", bottomShrine: "enemy" };
  const split = evaluate("용의 둥지", state, favorable);
  assert.match(split.action, /신단을 확보해 중앙 제단 개방/);
  assert.match(split.reason, /중앙 제단을 열 수 없습니다/);
});

test("unknown map state is not inferred and legacy state normalizes safely", () => {
  const state = normalizeState(undefined);
  assert.equal(evaluate("저주받은 골짜기", state, favorable), null);
  assert.equal(evaluate("파멸의 탑", state, favorable), null);
  assert.match(evaluate("용의 둥지", state, favorable).warning, /추정하지 않습니다/);
  assert.deepEqual(getMissingInfo("저주받은 골짜기", state), ["양 팀 공물 누적", "현재 저주 상태"]);
  assert.deepEqual(getMissingInfo("파멸의 탑", state), ["양 팀 종탑 보유 수"]);
  assert.deepEqual(getMissingInfo("용의 둥지", state), ["상·하단 신단 소유"]);

  const migrated = normalizeState({
    "저주받은 골짜기": { oursTributes: 3, enemyTributes: 1, curseStatus: "maybe" },
    "파멸의 탑": { oursBellTowers: -1, enemyBellTowers: 6 },
    "용의 둥지": { topShrine: "ours", bottomShrine: "unknown" }
  });
  assert.deepEqual(migrated["저주받은 골짜기"], { oursTributes: null, enemyTributes: 1, curseStatus: "unknown" });
  assert.deepEqual(migrated["파멸의 탑"], { oursBellTowers: null, enemyBellTowers: 6 });
  assert.deepEqual(migrated["용의 둥지"], { topShrine: "ours", bottomShrine: "unknown" });
});

test("map-specific state changes the final page recommendation without changing common game state", () => {
  const { coach } = loadCoachHarness();
  const scenarios = [
    {
      map: "저주받은 골짜기",
      clock: 150,
      first: { oursTributes: 0, enemyTributes: 0, curseStatus: "none" },
      second: { oursTributes: 2, enemyTributes: 0, curseStatus: "none" }
    },
    {
      map: "파멸의 탑",
      clock: 150,
      first: { oursBellTowers: 2, enemyBellTowers: 2 },
      second: { oursBellTowers: 5, enemyBellTowers: 1 }
    },
    {
      map: "용의 둥지",
      clock: 60,
      first: { topShrine: "ours", bottomShrine: "enemy" },
      second: { topShrine: "ours", bottomShrine: "ours" }
    }
  ];
  for (const scenario of scenarios) {
    const state = coach.defaultState();
    state.map = scenario.map;
    state.gameClockSeconds = scenario.clock;
    state.objective = "soon";
    state.oursLevel = state.enemyLevel = 10;
    for (const team of ["ours", "enemy"]) {
      state.battle[team] = Array.from({ length: 5 }, () => ({
        hero: "가로쉬", alive: true, respawn: null, ultimate: "ready"
      }));
    }
    state.mapStrategy[scenario.map] = scenario.first;
    coach.setState(state);
    const before = coach.makeRecommendation();
    state.mapStrategy[scenario.map] = scenario.second;
    coach.setState(state);
    const after = coach.makeRecommendation();
    assert.notEqual(after.action, before.action, `${scenario.map} state should change the final action`);
    assert.equal(after.category, "맵 전략");
  }
});

test("map clock alone provides lane, camp-planning, and objective-preparation recommendations", () => {
  const { coach } = loadCoachHarness();
  const state = coach.defaultState();
  state.phase = "game";
  state.map = "공포의 정원";
  coach.setState(state);

  state.gameClockSeconds = 0;
  const far = coach.makeRecommendation();
  assert.match(far.action, /라인 경험치/);
  assert.match(far.reason, /150초/);
  assert.match(far.warning, /캠프 등장 시각/);

  state.gameClockSeconds = 100;
  const preparation = coach.makeRecommendation();
  assert.match(preparation.action, /라인을 정리하고 팀 합류를 준비/);
  assert.match(preparation.reason, /50초/);

  state.gameClockSeconds = 130;
  const near = coach.makeRecommendation();
  assert.match(near.action, /팀과 합류 가능한 위치/);
  assert.match(near.reason, /20초/);
  assert.match(near.warning, /게임 내 신호/);
});

test("maps without a confirmed automatic objective schedule keep a safe baseline", () => {
  const { coach } = loadCoachHarness();
  const state = coach.defaultState();
  state.phase = "game";
  state.map = "거미 여왕의 무덤";
  state.gameClockSeconds = 240;
  coach.setState(state);

  const recommendation = coach.makeRecommendation();
  assert.match(recommendation.action, /안전한 라인 경험치/);
  assert.doesNotMatch(recommendation.reason, /오브젝트까지 \d+초/);
});

test("map state buttons update the recommendation immediately", () => {
  const { coach, querySelector } = loadCoachHarness();
  const state = coach.defaultState();
  state.map = "저주받은 골짜기";
  state.phase = "game";
  state.gameClockSeconds = 150;
  state.objective = "soon";
  state.oursLevel = state.enemyLevel = 10;
  for (const team of ["ours", "enemy"]) {
    state.battle[team] = Array.from({ length: 5 }, () => ({
      hero: "가로쉬", alive: true, respawn: null, ultimate: "ready"
    }));
  }
  state.mapStrategy["저주받은 골짜기"] = { oursTributes: 0, enemyTributes: 0, curseStatus: "none" };
  coach.setState(state);
  const controls = querySelector("#map-strategy-controls");
  const initialAction = coach.makeRecommendation().action;
  const click = controls.listeners.click;
  for (let index = 0; index < 2; index += 1) {
    const button = {
      dataset: { mapStep: "oursTributes", step: "1" },
      closest: (selector) => selector === "[data-map-step]" ? button : null
    };
    click({ target: button });
  }
  assert.equal(coach.makeRecommendation().action, "팀을 모아 세 번째 공물 경합을 준비하세요");
  assert.notEqual(coach.makeRecommendation().action, initialAction);
});

test("old saved state restores with empty map strategy values and keeps legacy timer migration", () => {
  const { coach } = loadCoachHarness();
  const restored = coach.normalizeState({
    phase: "game",
    map: "저주받은 골짜기",
    objectiveSeconds: 45
  });
  assert.equal(restored.mapStrategy["저주받은 골짜기"].oursTributes, null);
  assert.equal(restored.mapStrategy["용의 둥지"].topShrine, "unknown");
  assert.equal(restored.nextObjectiveAtOverride, 45);
});

test("random draft creates unique heroes, persists, and protects an existing draft from cancellation", () => {
  const { coach, querySelector, storage, setConfirmResult, getConfirmCalls } = loadCoachHarness();
  const state = coach.defaultState();
  coach.setState(state);
  const generate = querySelector("#random-draft").listeners.click;

  generate();
  const chosen = Object.values(state.draft).flat();
  assert.equal(chosen.length, 16);
  assert.ok(chosen.every(Boolean));
  assert.equal(new Set(chosen).size, 16);
  assert.equal(getConfirmCalls(), 0);
  assert.ok(storage.value);

  const previousDraft = JSON.stringify(state.draft);
  setConfirmResult(false);
  generate();
  assert.equal(JSON.stringify(state.draft), previousDraft);
  assert.equal(getConfirmCalls(), 1);
});

test("game screen keeps quick controls visible and groups detailed inputs under disclosures", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, new Set(ids).size, "HTML ids remain unique");
  const mapOptions = html.match(/<select id="map">([\s\S]*?)<\/select>/)?.[1].match(/<option(?![^>]*value="")[^>]*>/g);
  assert.equal(mapOptions?.length, 14, "all 14 battleground choices remain available");
  const prepScreen = html.match(/<section id="prep-screen"[\s\S]*?<\/section>\s*<section id="game-screen"/)?.[0];
  assert.doesNotMatch(prepScreen, /name="draft-order"|밴픽 순서|선픽|후픽/);

  const advancedTimer = html.match(/<details class="advanced-controls">([\s\S]*?)<\/details>/)?.[1];
  assert.ok(advancedTimer, "timer correction controls are in an advanced disclosure");
  assert.match(advancedTimer, /id="clock-seconds"/);
  assert.match(advancedTimer, /id="objective-time-override"/);
  assert.match(advancedTimer, /id="objective-undo"/);
  assert.doesNotMatch(html, /id="objective-seconds"/, "objective countdown has one editable source");
  assert.match(html, /<button id="objective-start"/);
  assert.match(html, /<button id="objective-end"/);

  const heroInputs = html.match(/<details[^>]*id="hero-details"[^>]*>\s*<summary>영웅별 생존 · 부활 · 궁극기<\/summary>([\s\S]*?)<\/details>/)?.[1];
  assert.match(heroInputs, /id="battle-rosters"/);
  const recommendationDetails = html.match(/<details class="recommendation-more">([\s\S]*?)<\/details>/)?.[1];
  assert.ok(html.indexOf('<p id="recommendation"') < html.indexOf('<details class="recommendation-more">'));
  assert.match(html, /<p id="reason" class="recommendation-reason">/);
  assert.ok(recommendationDetails.indexOf('id="warning-text"') >= 0, "warnings remain available in recommendation details");
  assert.match(recommendationDetails, /id="execution-condition"/);
  assert.match(recommendationDetails, /id="alternative"/);
  assert.ok(html.indexOf('id="fight-result"') < html.indexOf('class="objective-timer"'));
  const quickDashboard = html.match(/<section class="quick-dashboard card"([\s\S]*?)<\/section>/)?.[1];
  assert.match(html, /\.battle-layout \{ display: grid; grid-template-columns: minmax\(0, 1fr\) minmax\(300px, 360px\);/);
  assert.match(html, /\.side-column \{ grid-column: 2; grid-row: 1 \/ span 2;[^}]*position: sticky;/);
  assert.match(html, /@media \(max-width: 850px\) \{\s*\.battle-layout \{ grid-template-columns: minmax\(0, 1fr\); \}\s*\.side-column \{ display: contents; \}\s*\.recommendation \{ grid-column: 1; grid-row: 1; position: sticky;/);
  assert.match(html, /\.quick-dashboard \{ grid-column: 1; grid-row: 2; \}/);
  assert.match(html, /\.main-column \{ grid-column: 1; grid-row: 3; \}/);
  assert.match(quickDashboard, /id="game-clock"/);
  assert.match(quickDashboard, /id="quick-objective-countdown"/);
  assert.match(quickDashboard, /id="game-start"[^>]*>게임 시작/);
  assert.match(quickDashboard, /id="game-end"[^>]*disabled>게임 종료/);
  assert.match(quickDashboard, /id="match-status"/);
  assert.match(quickDashboard, /id="quick-death-counts"/);
  assert.match(quickDashboard, /data-death-team="ours"/);
  assert.match(quickDashboard, /data-death-team="enemy"/);
  assert.match(html, /id="start-match"[^>]*>새 경기 시작/);
  assert.match(html, /id="resume-match"[^>]*hidden>저장된 경기 이어하기/);
  assert.doesNotMatch(quickDashboard, /간편 모드/);
  assert.match(quickDashboard, /id="back-to-prep"[^>]*>준비 화면으로/);
  for (const action of ["objective-contested", "ally-dead"]) {
    assert.match(quickDashboard, new RegExp(`data-quick-action="${action}"`));
  }
  assert.doesNotMatch(quickDashboard, /data-quick-action="fight-(?:won|lost)"/);
  assert.match(html, /<details id="detailed-inputs" class="full-controls">/);
});

test("bilingual encouragement quote is shown above the page and rotates without an immediate repeat", () => {
  const { coach, querySelector, runIntervals } = loadCoachHarness();
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const quotes = [
    ["It ain't over till it's over.", "끝날 때까지 끝난 게 아니다."],
    ["One good fight can change everything.", "단 한 번의 좋은 한타가 모든 것을 바꿀 수 있다."],
    ["As long as the Nexus stands, you have a chance.", "핵이 살아 있는 한, 기회는 남아 있다."],
    ["You can't control your teammates. You can control your next decision.", "팀원은 통제할 수 없다. 하지만 다음 판단은 통제할 수 있다."],
    ["Don't tilt. Adapt.", "멘탈 무너지지 마. 적응해."],
    ["Win the game, not the argument.", "말싸움에서 이기지 말고 게임에서 이겨라."],
    ["A mistake is only wasted if you learn nothing from it.", "실수에서 배우지 못할 때, 그 실수는 낭비가 된다."],
    ["Play the next fight, not the last one.", "지난 한타가 아니라 다음 한타를 플레이해라."],
    ["Your last death is not your next decision.", "방금 죽었다고 다음 판단까지 망칠 필요는 없다."],
    ["You don't need to carry every fight. Just make the next one better.", "모든 한타를 캐리할 필요는 없다. 다음 한타를 더 잘하면 된다."],
    ["The goal is not to play perfectly. It's to make fewer losing decisions.", "완벽한 플레이가 아니라, 패배로 이어지는 판단을 줄이는 게 목표다."],
    ["You can lose the game without losing your composure.", "게임은 져도 평정심까지 잃을 필요는 없다."]
  ];
  const english = querySelector("#coach-quote-en").textContent;
  const korean = querySelector("#coach-quote-ko").textContent;
  const initialIndex = quotes.findIndex(([en, ko]) => en === english && ko === korean);

  assert.ok(initialIndex >= 0, "initial English and Korean quote is a matching pair");
  assert.equal((html.match(/\["(?:It ain't over|One good fight|As long as the Nexus|You can't control|Don't tilt|Win the game|A mistake|Play the next fight|Your last death|You don't need to carry|The goal is not|You can lose the game)/g) || []).length, 12);
  assert.ok(html.indexOf('class="coach-quote"') < html.indexOf("<header>"), "quote appears above the page header");
  assert.match(html, /window\.setInterval\(rotateCoachQuote, 60000\)/, "each quote remains visible for one minute");

  runIntervals();
  const nextEnglish = querySelector("#coach-quote-en").textContent;
  const nextKorean = querySelector("#coach-quote-ko").textContent;
  assert.ok(quotes.some(([en, ko]) => en === nextEnglish && ko === nextKorean), "next quote remains a matching pair");
  assert.notEqual(nextEnglish, english, "the same quote is not repeated consecutively");
});

test("new match resets match data while resume restores the saved match", () => {
  const { coach, querySelector, getConfirmCalls, setConfirmResult } = loadCoachHarness();
  const state = coach.defaultState();
  state.matchInitialized = true;
  state.phase = "prep";
  state.map = "용의 둥지";
  state.draft.ourPicks[0] = "가로쉬";
  state.gameClockSeconds = 245;
  state.gameStatus = "active";
  state.gameClockStartedAt = Date.now();
  state.objectiveSeconds = 45;
  state.oursLevel = 18;
  state.fightResult = "won";
  state.reportedDeaths.ours = 2;
  state.battle.ours[0].alive = false;
  coach.setState(state);

  setConfirmResult(false);
  querySelector("#start-match").listeners.click();
  assert.equal(coach.getState().phase, "prep", "cancel keeps the saved match");
  assert.equal(coach.getState().gameClockSeconds, 245);
  assert.equal(getConfirmCalls(), 1);

  setConfirmResult(true);
  querySelector("#start-match").listeners.click();
  const fresh = coach.getState();
  assert.equal(getConfirmCalls(), 2);
  assert.equal(fresh.phase, "game");
  assert.equal(fresh.map, "용의 둥지");
  assert.equal(fresh.draft.ourPicks[0], "가로쉬");
  assert.equal(fresh.gameClockSeconds, 0);
  assert.equal(fresh.gameStatus, "waiting");
  assert.equal(fresh.objectiveSeconds, null);
  assert.equal(fresh.matchInitialized, true);
  assert.equal(fresh.oursLevel, null);
  assert.equal(fresh.fightResult, "unknown");
  assert.equal(fresh.reportedDeaths.ours, null);
  assert.equal(fresh.battle.ours[0].alive, true);

  fresh.phase = "prep";
  fresh.gameClockSeconds = 370;
  fresh.gameStatus = "active";
  fresh.gameClockStartedAt = Date.now();
  querySelector("#resume-match").listeners.click();
  assert.equal(fresh.phase, "game");
  assert.equal(fresh.gameClockSeconds, 370);
  assert.equal(fresh.gameStatus, "active");
});

test("quick team death counts update survival and fight recommendations without roster attribution", () => {
  const { coach, querySelector } = loadCoachHarness();
  const state = coach.defaultState();
  coach.setState(state);
  const click = querySelector("#quick-death-counts").listeners.click;
  const press = (team, step) => click({
    target: {
      closest: () => ({ dataset: { deathTeam: team, step: String(step) } })
    }
  });

  press("ours", 1);
  press("enemy", 2);
  assert.equal(state.reportedDeaths.ours, 1);
  assert.equal(state.reportedDeaths.enemy, 2);
  const oursSurvival = coach.teamSurvival("ours");
  assert.equal(oursSurvival.confirmedAlive, 4);
  assert.equal(oursSurvival.possibleAlive, 4);
  assert.equal(oursSurvival.unknownHeroes, 0);
  assert.equal(oursSurvival.reportedUnknownDeaths, 1);
  assert.match(coach.makeRecommendation().analysis.join(" "), /우리 1명 \/ 상대 2명/);

  state.battle.ours[0].alive = false;
  assert.equal(coach.teamSurvival("ours").confirmedAlive, 4, "reported and individual deaths are not double-counted");
});

test("respawn countdown revives a dead member at zero", () => {
  const { coach, setTime, runIntervals, now } = loadCoachHarness();
  const state = coach.defaultState();
  const member = state.battle.ours[0];
  member.alive = false;
  member.respawn = 2;
  member.respawnStartedAt = now();
  coach.setState(state);

  setTime(now() + 1000);
  runIntervals();
  assert.equal(coach.respawnSecondsRemaining(member), 1);
  assert.equal(member.alive, false);

  setTime(now() + 1000);
  runIntervals();
  assert.equal(member.alive, true);
  assert.equal(member.respawn, null);
  assert.equal(member.respawnStartedAt, null);
});

test("quick objective controls preserve start, secure, correction, and undo behavior", () => {
  const { coach, querySelector } = loadCoachHarness();
  const state = coach.defaultState();
  state.phase = "game";
  state.map = "저주받은 골짜기";
  state.gameClockSeconds = 240;
  state.gameClockStartedAt = null;
  coach.setState(state);

  querySelector("#objective-time-override").value = "05:30";
  querySelector("#objective-time-set").listeners.click();
  assert.equal(state.nextObjectiveAtOverride, 330);
  assert.equal(state.objectiveSeconds, null);

  querySelector("#objective-start").listeners.click();
  assert.equal(state.objectiveEventStatus, "active");
  assert.equal(state.objective, "contested");
  querySelector("#objective-winner").value = "ours";
  querySelector("#objective-end").listeners.click();
  assert.equal(state.objectiveEventStatus, "ended");
  assert.equal(state.objectiveSecuredBy, "ours");

  querySelector("#objective-undo").listeners.click();
  assert.equal(state.objectiveEventStatus, "active");
  assert.equal(state.objective, "contested");
});

test("quick objective card updates recommendation and ally death card reveals details", () => {
  const { coach, querySelector } = loadCoachHarness();
  const state = coach.defaultState();
  state.map = "저주받은 골짜기";
  state.gameClockSeconds = 140;
  state.gameClockStartedAt = null;
  coach.setState(state);
  coach.renderObjectiveTimer();
  assert.equal(querySelector("#quick-objective-countdown").textContent, "40초 후");
  const click = querySelector(".quick-choice-grid").listeners.click;

  const clickAction = (action) => {
    const button = {
      dataset: { quickAction: action },
      closest: (selector) => selector === "[data-quick-action]" ? button : null
    };
    click({ target: button });
  };
  clickAction("objective-contested");
  assert.equal(state.objectiveEventStatus, "active");
  assert.equal(state.objective, "contested");
  assert.equal(querySelector("#quick-objective-countdown").textContent, "진행 중");
  clickAction("ally-dead");
  assert.equal(querySelector("#detailed-inputs").open, true);
  assert.equal(querySelector("#hero-details").open, true);
});
