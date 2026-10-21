(() => {
  "use strict";

  const maps = {
    "저주받은 골짜기": {
      facts: [
        "공물 3개를 모으면 상대에게 70초 저주가 걸립니다.",
        "저주 중 상대 요새는 공격하지 않고 미니언 체력은 1이 됩니다.",
        "상대가 먼저 저주를 발동해도 우리 팀 공물 누적은 유지됩니다.",
        "공물 획득에는 6초 채널이 필요하며 피해를 받거나 이동하면 중단됩니다."
      ],
      source: "https://heroesofthestorm.fandom.com/wiki/Cursed_Hollow"
    },
    "파멸의 탑": {
      facts: [
        "영웅은 코어를 직접 공격할 수 없고, 제단을 활성화하면 종탑이 상대 코어에 피해를 줍니다.",
        "보유 종탑 수가 제단 피해량에 영향을 줍니다.",
        "제단 활성화에는 6초 채널이 필요합니다.",
        "용병이 오브젝트 진행 중 비활성화되지 않아 안전한 캠프·라인 압박을 비교할 수 있습니다."
      ],
      source: "https://heroesofthestorm.fandom.com/wiki/Towers_of_Doom"
    },
    "용의 둥지": {
      facts: [
        "상·하단 신단을 모두 보유해야 중앙 제단이 열립니다.",
        "신단은 경합 중 점령 진행이 멈추며, 상대 신단 탈환에는 더 오래 걸립니다.",
        "중앙 제단은 3초 채널로 활성화하며 피해를 받거나 이동하면 중단됩니다.",
        "용기사가 활성화되면 용기사 처치 전까지 용병 캠프가 비활성화됩니다."
      ],
      source: "https://heroesofthestorm.fandom.com/wiki/Dragon_Shire"
    }
  };

  const createDefaultState = () => ({
    "저주받은 골짜기": { oursTributes: null, enemyTributes: null, curseStatus: "unknown" },
    "파멸의 탑": { oursBellTowers: null, enemyBellTowers: null },
    "용의 둥지": { topShrine: "unknown", bottomShrine: "unknown" }
  });

  function normalizeState(value) {
    const fresh = createDefaultState();
    if (!value || typeof value !== "object") return fresh;
    const cursed = value["저주받은 골짜기"];
    if (cursed && typeof cursed === "object") {
      for (const key of ["oursTributes", "enemyTributes"]) {
        if (Number.isInteger(cursed[key]) && cursed[key] >= 0 && cursed[key] <= 2) fresh["저주받은 골짜기"][key] = cursed[key];
      }
      if (["unknown", "none", "ours", "enemy"].includes(cursed.curseStatus)) {
        fresh["저주받은 골짜기"].curseStatus = cursed.curseStatus;
      }
    }
    const towers = value["파멸의 탑"];
    if (towers && typeof towers === "object") {
      for (const key of ["oursBellTowers", "enemyBellTowers"]) {
        if (Number.isInteger(towers[key]) && towers[key] >= 0 && towers[key] <= 6) fresh["파멸의 탑"][key] = towers[key];
      }
    }
    const dragon = value["용의 둥지"];
    if (dragon && typeof dragon === "object") {
      for (const key of ["topShrine", "bottomShrine"]) {
        if (["unknown", "ours", "enemy", "contested"].includes(dragon[key])) fresh["용의 둥지"][key] = dragon[key];
      }
    }
    return fresh;
  }

  function getMissingInfo(map, state) {
    if (!state || !maps[map]) return [];
    const data = state[map];
    if (map === "저주받은 골짜기") {
      const missing = [];
      if (!Number.isInteger(data?.oursTributes) || !Number.isInteger(data?.enemyTributes)) missing.push("양 팀 공물 누적");
      if (!data?.curseStatus || data.curseStatus === "unknown") missing.push("현재 저주 상태");
      return missing;
    }
    if (map === "파멸의 탑") {
      return Number.isInteger(data?.oursBellTowers) && Number.isInteger(data?.enemyBellTowers)
        ? []
        : ["양 팀 종탑 보유 수"];
    }
    return ["ours", "enemy", "contested"].includes(data?.topShrine)
      && ["ours", "enemy", "contested"].includes(data?.bottomShrine)
      ? []
      : ["상·하단 신단 소유"];
  }

  const candidate = (action, reason, alternative, executionCondition, warning, expectedBenefit, risk) => ({
    action,
    reason,
    alternative,
    executionCondition,
    warning,
    expectedBenefit,
    risk,
    category: "맵 전략"
  });

  function evaluate(map, state, common) {
    if (!state || !common || common.severeSurvivalRisk) return null;
    const eventRelevant = common.objectiveActive
      && (common.objectivePhase === "active" || common.objectiveSeconds === null || common.objectiveSeconds <= 90);
    const canContest = common.confirmedRallyAdvantage
      || (common.oursAlive >= common.enemyPossibleAlive && !common.levelDisadvantage);

    if (map === "저주받은 골짜기") {
      const data = state[map];
      if (data?.curseStatus === "ours") {
        return candidate(
          "저주 시간에 라인을 밀고 구조물을 압박하세요",
          "우리 팀 저주가 진행 중입니다. 상대 구조물 공격과 미니언 방어가 약화되는 시간에 지도 이득을 전환할 수 있습니다.",
          "적 위치가 불명확하면 안전한 웨이브만 정리하고 팀과 재집결하세요.",
          "아군이 함께 있고 적의 위치를 확인한 라인만 압박하세요. 저주가 끝나거나 적이 모이면 즉시 이탈하세요.",
          "공물 누적 수와 구조물 상태는 입력되지 않았으므로 저주 이후의 승리까지 보장하지 않습니다.",
          "약화된 방어를 이용해 안전한 구조물·라인 이득을 얻을 수 있습니다.",
          "깊게 전진하면 저주가 끝난 뒤 고립되어 역습을 받을 수 있습니다."
        );
      }
      if (data?.curseStatus === "enemy") {
        return candidate(
          "저주받은 라인을 안전하게 정리하고 구조물 뒤에서 방어하세요",
          "상대 저주 중에는 우리 구조물이 공격하지 않고 미니언이 약해집니다. 무리한 외곽 교전보다 웨이브와 생존을 우선합니다.",
          "적이 멀리 보이고 아군이 모였을 때만 가까운 안전한 캠프나 반대 라인으로 교환하세요.",
          "저주가 끝날 때까지 위험한 구조물 밖 교전을 피하고, 웨이브를 정리한 뒤 안전 지점으로 후퇴하세요.",
          "상대 저주가 끝나는 시각과 현재 구조물 체력은 입력되지 않았습니다.",
          "불필요한 사망과 구조물 손실을 줄일 수 있습니다.",
          "라인을 완전히 포기하면 저주가 구조물 피해로 이어질 수 있습니다."
        );
      }
      if (!data || !Number.isInteger(data.oursTributes) || !Number.isInteger(data.enemyTributes) || !eventRelevant) return null;
      if (data.oursTributes === 2) {
        if (!canContest) {
          return candidate(
            "세 번째 공물 정면 경합을 보류하고 안전한 라인·캠프 교환을 찾으세요",
            "우리 팀 공물이 2개라 다음 공물은 저주를 완성할 수 있지만, 현재 입력에서 확정적인 교전 우위가 확인되지 않습니다.",
            "팀이 모이고 적의 위치가 확인되면 공물 주변 시야를 확보한 뒤 재평가하세요.",
            "단독으로 채널을 끊으러 들어가지 말고, 아군 합류 또는 적 사망으로 조건이 나아질 때만 경합하세요.",
            "공물 수만으로 교전을 강제하지 않습니다. 부활·위치·체력·궁극기 상세는 일부 미확인일 수 있습니다.",
            "위험한 사망 없이 경험치나 캠프를 확보하며 저주 완성 기회를 다시 볼 수 있습니다.",
            "공물을 넘기면 적이 먼저 저주를 완성할 수 있으며 현재 상황에선 누적 상태도 고려해야 합니다."
          );
        }
        return candidate(
          "팀을 모아 세 번째 공물 경합을 준비하세요",
          "우리 팀 공물이 2개여서 공물 하나를 확보하면 상대에게 저주를 걸 수 있습니다. 현재 생존·합류 조건이 대등하거나 나을 때 경합 가치가 커집니다.",
          "적이 먼저 자리를 잡았거나 합류 우위가 사라지면 공물 채널을 포기하고 안전한 라인·캠프로 교환하세요.",
          "먼저 팀을 모아 진입로를 확인하고, 인원 우위가 유지될 때 채널을 보호하세요. 숫자 우위가 사라지면 즉시 중단하세요.",
          "공물 위치는 여러 지점 중 무작위이며 입력되지 않았습니다. 이동 시간과 채널 성공 여부도 확정할 수 없습니다.",
          "세 번째 공물 확보 시 70초 저주로 연결될 수 있습니다.",
          "무리한 채널 시도는 저주를 놓치고 사망까지 발생시킬 수 있습니다."
        );
      }
      if (data.enemyTributes === 2) {
        return candidate(
          canContest ? "팀을 모아 적의 세 번째 공물 확보를 견제하세요" : "공물 진입을 피하고 저주 방어를 준비하세요",
          canContest
            ? "상대 팀 공물이 2개라 다음 공물 확보 시 저주가 발생할 수 있습니다. 현재 교전 조건이 대등하거나 나을 때만 진입을 고려합니다."
            : "상대 팀이 공물 2개를 모았지만 우리 팀의 확정 교전 우위가 없습니다. 무리한 진입보다 저주 방어 준비가 안전합니다.",
          "경합이 불리하면 공물을 포기하고 웨이브 정리·반대편 안전 교환을 선택하세요.",
          canContest
            ? "아군이 함께 도착하고 적의 핵심 진입 경로가 확인될 때만 견제하세요. 인원 우위가 사라지면 이탈하세요."
            : "팀을 구조물 근처에 모으고 저주 동안 위험한 외부 교전을 피하세요.",
          "적 공물 누적은 적이 먼저 저주를 발동할 때까지 유지됩니다. 위치와 부활 시점은 별도 확인이 필요합니다.",
          "적의 저주 완성 또는 그로 인한 위험을 늦출 수 있습니다.",
          "숫자 열세에서 진입하면 저주를 막지 못한 채 추가 사망할 수 있습니다."
        );
      }
      return null;
    }

    if (map === "파멸의 탑") {
      const data = state[map];
      if (!data || !Number.isInteger(data.oursBellTowers) || !Number.isInteger(data.enemyBellTowers) || !eventRelevant) return null;
      const towerLead = data.oursBellTowers - data.enemyBellTowers;
      if (towerLead >= 2 && canContest) {
        return candidate(
          "아군 종탑 우위를 활용해 제단을 확보하세요",
          `우리 팀 종탑 ${data.oursBellTowers}개, 상대 ${data.enemyBellTowers}개로 제단 피해 계산에 유리한 구조입니다. 합류 조건이 대등하거나 우세할 때 제단 가치가 커집니다.`,
          "적이 먼저 진입했거나 아군 우위가 깨지면 제단 대신 안전한 종탑 압박으로 전환하세요.",
          "종탑 우위와 아군 합류가 유지될 때 제단 채널을 시작하고, 적이 다수 합류하면 중단해 종탑을 지키세요.",
          "현재 코어 생명력, 제단 위치·개수, 종탑별 위험도는 입력되지 않았습니다.",
          "제단 피해와 종탑 우위를 함께 활용할 가능성이 있습니다.",
          "제단 채널 중 종탑을 내주면 이후 제단 피해 우위가 줄어들 수 있습니다."
        );
      }
      if (towerLead <= -2 && !canContest) {
        return candidate(
          "불리한 제단 경합보다 안전한 종탑 탈환·용병 압박을 찾으세요",
          `상대 종탑 ${data.enemyBellTowers}개, 우리 ${data.oursBellTowers}개로 제단 피해 구조가 불리하고 합류 우위도 확인되지 않습니다.`,
          "종탑을 안전하게 탈환할 수 없다면 웨이브 경험치만 챙기고 아군과 재정비하세요.",
          "적 위치가 확인되고 함께 압박할 수 있을 때만 종탑을 공격하세요. 상대가 사라지거나 합류하면 후퇴하세요.",
          "코어 생명력과 현재 제단 위치는 모릅니다. 종탑 수 차이만으로 제단 가치 전체를 확정하지 않습니다.",
          "다음 제단 전에 종탑 피해 구조를 개선하거나 안전한 지도 자원을 교환할 수 있습니다.",
          "종탑 수복을 시도하다가 제단과 구조물 양쪽을 잃거나 추가 사망할 수 있습니다."
        );
      }
      if (towerLead <= -2 && canContest) {
        return candidate(
          "팀을 모아 제단과 종탑 중 안전하게 지킬 목표를 먼저 확인하세요",
          `종탑 수는 상대 ${data.enemyBellTowers}개, 우리 ${data.oursBellTowers}개로 불리하지만 현재 합류 가능성은 경합을 고려할 여지가 있습니다.`,
          "제단 진입이 위험해지면 상대 종탑 탈환이나 안전한 웨이브 교환으로 바꾸세요.",
          "제단 위치와 적 인원을 확인해 수적 우위가 지속될 때만 진입하세요. 적이 먼저 모이면 바로 빠져 종탑을 지키세요.",
          "종탑 수는 제단 피해에 영향을 주지만 현재 코어 체력과 제단 구성을 알 수 없습니다.",
          "제단 피해를 줄 기회를 유지하면서 열세 종탑을 방어할 수 있습니다.",
          "불리한 종탑 상태에서 제단을 무리하게 밀면 코어 피해와 종탑 손실을 모두 허용할 수 있습니다."
        );
      }
      if (towerLead >= 2 && !canContest) {
        return candidate(
          "종탑을 지키며 불리한 제단 진입을 미루세요",
          "종탑 우위는 제단 피해에 유리하지만 현재 교전 우위는 확인되지 않아, 종탑을 보존하는 편이 안전할 수 있습니다.",
          "적이 제단에서 이탈하거나 아군이 합류한 뒤 제단을 재평가하세요.",
          "종탑을 수비할 수 있는 위치에서 대기하고 숫자 우위가 확인될 때만 제단으로 이동하세요.",
          "종탑 상태 외의 코어 생명력, 시야, 제단 위치는 입력되지 않았습니다.",
          "현재의 제단 피해 우위를 보존할 수 있습니다.",
          "제단을 포기하면 적이 코어 피해를 얻을 수 있습니다."
        );
      }
      return null;
    }

    if (map === "용의 둥지") {
      const data = state[map];
      if (!data) return null;
      if (!eventRelevant) return null;
      const shrines = [data.topShrine, data.bottomShrine];
      if (shrines.some((shrine) => shrine === "unknown")) {
        return candidate(
          "상·하단 신단 소유를 확인한 뒤 합류 목표를 정하세요",
          "용의 둥지는 두 신단을 모두 보유해야 중앙 제단을 열 수 있습니다. 현재 신단 상태가 미확인이라 중앙 진입과 캠프 교환의 적절성을 판단할 수 없습니다.",
          "신단 상태를 확인할 수 없다면 안전한 웨이브를 정리하고 중앙에 단독 진입하지 마세요.",
          "양 신단의 소유를 입력한 뒤 팀이 함께 도착할 수 있는 신단부터 판단하세요. 적 위치를 모르면 진입을 보류하세요.",
          "입력하지 않은 신단 소유와 캠프 가용 상태는 추정하지 않습니다.",
          "목표 개방 조건을 확인해 불필요한 중앙 집결이나 캠프 시도를 줄일 수 있습니다.",
          "확인 없이 중앙이나 캠프로 이동하면 신단 통제와 라인 경험치를 잃을 수 있습니다."
        );
      }
      const bothOurs = shrines.every((shrine) => shrine === "ours");
      const bothEnemy = shrines.every((shrine) => shrine === "enemy");
      if (!bothOurs && !bothEnemy) {
        const target = data.topShrine === "ours" ? "하단" : data.bottomShrine === "ours" ? "상단" : "가까운";
        return candidate(
          `${target} 신단을 확보해 중앙 제단 개방 조건을 만드세요`,
          eventRelevant
            ? "두 신단을 모두 보유한 팀이 없어 중앙 제단을 열 수 없습니다. 단순 중앙 집결보다 상대 신단을 되찾는 편이 목표에 직접 연결됩니다."
            : "현재 두 신단을 모두 보유한 팀이 없어 중앙 용기사 제단이 잠겨 있습니다. 단순 중앙 집결보다 신단 통제가 우선입니다.",
          "신단 교전이 불리하면 안전한 라인 경험치를 챙기고 아군 합류를 기다리세요.",
          "아군이 함께 도착하고 적의 합류를 확인할 수 있는 신단부터 압박하세요. 적이 먼저 모이면 점령을 중단하세요.",
          "신단까지 거리와 적 위치는 입력되지 않았으며, 경합 중 신단의 점령 진행은 멈출 수 있습니다.",
          "중앙 제단을 열 수 있는 맵 고유 조건에 가까워집니다.",
          "한 신단에 인원을 오래 묶으면 다른 라인 경험치와 반대 신단을 내줄 수 있습니다."
        );
      }
      if (bothOurs && eventRelevant) {
        return candidate(
          canContest ? "두 신단 우위를 지키고 중앙 제단에서 용기사를 확보하세요" : "두 신단을 수비하고 불리한 중앙 채널은 보류하세요",
          canContest
            ? "두 신단이 우리 팀 소유라 중앙 제단이 열려 있으며, 현재 합류 조건이 나을 때 용기사를 노릴 수 있습니다."
            : "두 신단은 보유 중이지만 채널 도중 방해받거나 신단을 빼앗기면 제단이 잠길 수 있어 안전 확인이 먼저입니다.",
          "적이 중앙에 먼저 모였거나 신단을 위협하면 중앙 채널보다 신단을 방어하세요.",
          canContest
            ? "중앙 제단 채널을 아군이 보호하고 두 신단 소유가 유지될 때만 진행하세요. 채널 방해나 신단 상실 시 중단하세요."
            : "아군 합류와 시야가 확보될 때까지 신단 주변을 지키고, 단독 채널을 시도하지 마세요.",
          "용기사의 남은 지속 시간, 체력, 구조물 상태는 입력되지 않았습니다.",
          "용기사 확보 시 구조물 압박을 위한 강한 지도 자원을 얻을 수 있습니다.",
          "중앙에서 채널을 시도하는 동안 신단을 빼앗기거나 채널이 끊길 수 있습니다."
        );
      }
      if (bothEnemy && eventRelevant) {
        return candidate(
          canContest ? "중앙 진입보다 안전한 신단 하나를 탈환해 제단을 잠그세요" : "중앙 교전을 피하고 라인 경험치와 안전한 재정비를 우선하세요",
          canContest
            ? "상대가 두 신단을 가져 중앙 제단을 열 수 있습니다. 신단 하나를 탈환하면 상대의 제단 접근을 차단할 수 있지만, 진입 우위가 확인될 때만 시도해야 합니다."
            : "상대가 두 신단을 보유하고 중앙 제단도 열려 있을 수 있지만 현재 교전 우위가 확인되지 않습니다.",
          "신단 탈환이 위험하면 반대 라인 웨이브를 정리하고 적이 분산될 때 다시 판단하세요.",
          canContest
            ? "팀을 모아 방어가 약한 신단을 확인한 뒤 함께 진입하세요. 적이 먼저 모이면 즉시 이탈하세요."
            : "중앙 제단에 단독 진입하지 말고 아군 구조물 근처에서 합류를 기다리세요.",
          "상대 중앙 채널 진행도와 양 신단에 배치된 영웅 수는 입력되지 않았습니다.",
          "신단 하나를 되찾으면 중앙 목표를 잠그고 다음 기회를 만들 수 있습니다.",
          "탈환 시도가 실패하면 중앙 제단과 신단을 모두 내주고 사망할 수 있습니다."
        );
      }
      return null;
    }
    return null;
  }

  globalThis.HotsMapStrategies = Object.freeze({
    maps: Object.freeze(maps),
    createDefaultState,
    getMissingInfo,
    normalizeState,
    evaluate
  });
})();
