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
    setInterval() {},
    confirm() { confirmCalls += 1; return confirmResult; },
    scrollTo() {}
  };
  const storage = { value: null, getItem: () => null, setItem(_key, value) { this.value = value; } };
  const context = {
    document,
    window,
    localStorage: storage,
    console,
    Date
  };
  const root = path.join(__dirname, "..");
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "map-strategies.js"), "utf8"), context);
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(inlineScript, "page has an inline application script");
  const hook = `window.__coachTest = { defaultState, setState: (next) => { state = next; }, makeRecommendation, normalizeState };
        loadState();`;
  const instrumented = inlineScript.replace("        loadState();", hook);
  assert.notEqual(instrumented, inlineScript, "test hook insertion point exists");
  vm.runInContext(instrumented, context, { filename: "index.html" });
  return {
    coach: window.__coachTest,
    querySelector,
    storage,
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

  const advancedTimer = html.match(/<details class="advanced-controls">([\s\S]*?)<\/details>/)?.[1];
  assert.ok(advancedTimer, "timer correction controls are in an advanced disclosure");
  assert.match(advancedTimer, /id="clock-seconds"/);
  assert.match(advancedTimer, /id="objective-time-override"/);
  assert.match(advancedTimer, /id="objective-undo"/);
  assert.doesNotMatch(html, /id="objective-seconds"/, "objective countdown has one editable source");
  assert.match(html, /<button id="objective-start"/);
  assert.match(html, /<button id="objective-end"/);

  const heroInputs = html.match(/<details class="secondary-inputs">\s*<summary>영웅별 생존 · 부활 · 궁극기<\/summary>([\s\S]*?)<\/details>/)?.[1];
  assert.match(heroInputs, /id="battle-rosters"/);
  const recommendationDetails = html.match(/<details class="recommendation-more">([\s\S]*?)<\/details>/)?.[1];
  assert.ok(html.indexOf('<p id="recommendation"') < html.indexOf('<details class="recommendation-more">'));
  assert.match(recommendationDetails, /id="execution-condition"/);
  assert.match(recommendationDetails, /id="alternative"/);
  assert.ok(html.indexOf('id="fight-result"') < html.indexOf('class="objective-timer"'));
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
