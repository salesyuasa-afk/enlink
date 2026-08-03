(() => {
  "use strict";

  const SEARCH_PAGE_SIZE = 60;
  const PROFILE_STORAGE_KEY = "enlink-profile-details-v2";
  const propsCache = new WeakMap();
  const indexCache = new WeakMap();
  let enhanceQueued = false;

  const normalizePart = (value) =>
    String(value ?? "")
      .normalize("NFKC")
      .toLocaleLowerCase("ja-JP")
      .replace(/[\s\u3000・･|｜/／\\()（）［］\[\]【】「」『』,，.．:：;；_-]+/g, "");

  const queryTokens = (value) =>
    String(value ?? "")
      .normalize("NFKC")
      .toLocaleLowerCase("ja-JP")
      .trim()
      .split(/[\s\u3000]+/)
      .map(normalizePart)
      .filter(Boolean);

  const isDataProps = (props) =>
    Array.isArray(props?.members) && Array.isArray(props?.regionGroups);

  const componentProps = (card) => {
    const cached = propsCache.get(card);
    if (cached && isDataProps(cached)) return cached;

    for (const key of Object.keys(card)) {
      if (key.startsWith("__reactProps$") && isDataProps(card[key])) {
        propsCache.set(card, card[key]);
        return card[key];
      }
    }

    const fiberKey = Object.keys(card).find((key) =>
      key.startsWith("__reactFiber$"),
    );
    let fiber = fiberKey ? card[fiberKey] : null;
    let depth = 0;
    while (fiber && depth++ < 30) {
      if (isDataProps(fiber.memoizedProps)) {
        propsCache.set(card, fiber.memoizedProps);
        return fiber.memoizedProps;
      }
      fiber = fiber.return;
    }
    return null;
  };

  const buildIndex = (props) => {
    const cached = indexCache.get(props.members);
    if (cached) return cached;

    const regionByChapter = new Map();
    props.regionGroups.forEach((group) =>
      group.chapters.forEach((chapter) =>
        regionByChapter.set(chapter, group.label),
      ),
    );
    const index = props.members.map((member) => {
      const region = regionByChapter.get(member.chapter) ?? "";
      return {
        key: normalizePart(
          `${member.name} ${member.category} ${member.chapter} ${region} ${member.area ?? ""}`,
        ),
        member,
        region,
      };
    });
    indexCache.set(props.members, index);
    return index;
  };

  const setNativeValue = (element, value) => {
    const prototype =
      element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const waitFor = (check, timeout = 5000) =>
    new Promise((resolve) => {
      const started = performance.now();
      let observer;
      let timer;
      const finish = (value) => {
        observer?.disconnect();
        clearTimeout(timer);
        resolve(value);
      };
      const test = () => {
        const result = check();
        if (result) return finish(result);
        if (performance.now() - started >= timeout) return finish(null);
        return null;
      };
      if (test()) return;
      observer = new MutationObserver(test);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      const poll = () => {
        if (!test()) timer = setTimeout(poll, 80);
      };
      timer = setTimeout(poll, 80);
    });

  const chooseMember = async (card, member, regionGroups) => {
    const group = regionGroups.find((item) =>
      item.chapters.includes(member.chapter),
    );
    const selects = () => card.querySelectorAll("select");
    const status = card.querySelector(".member-search__status");
    if (!group || selects().length < 3) return false;

    status.textContent = "選択中…";
    setNativeValue(selects()[0], group.label);
    const chapterSelect = await waitFor(() => {
      const select = selects()[1];
      return select && [...select.options].some((option) => option.value === member.chapter)
        ? select
        : null;
    });
    if (!chapterSelect) {
      status.textContent = "チャプターを選択できませんでした。もう一度お試しください。";
      return false;
    }

    setNativeValue(chapterSelect, member.chapter);
    const memberSelect = await waitFor(() => {
      const select = selects()[2];
      return select && [...select.options].some((option) => option.value === member.id)
        ? select
        : null;
    });
    if (!memberSelect) {
      status.textContent = "メンバーを選択できませんでした。もう一度お試しください。";
      return false;
    }

    setNativeValue(memberSelect, member.id);
    const selected = await waitFor(() => selects()[2]?.value === member.id, 2500);
    if (selected) {
      await new Promise((resolve) => setTimeout(resolve, 120));
      const sideIndex = [...document.querySelectorAll(".person-card")].indexOf(card);
      const profileCard = document.querySelectorAll(".profile-fallback")[sideIndex];
      if (sideIndex >= 0 && profileCard) restoreProfile(sideIndex, profileCard);
      scheduleEnhance();
      setTimeout(() => {
        const latestProfileCard = document.querySelectorAll(".profile-fallback")[sideIndex];
        if (sideIndex >= 0 && latestProfileCard) restoreProfile(sideIndex, latestProfileCard);
        enhanceCollaborationProposals();
      }, 300);
    }
    status.textContent = selected ? `${member.name}さんを選択しました` : "選択を完了できませんでした。";
    return Boolean(selected);
  };

  const renderResults = (card, input, results, limit = SEARCH_PAGE_SIZE) => {
    const props = componentProps(card);
    const tokens = queryTokens(input.value);
    results.replaceChildren();
    if (!tokens.length) {
      results.hidden = true;
      return;
    }
    if (!props) {
      results.hidden = false;
      const loading = document.createElement("p");
      loading.textContent = "メンバー情報を読み込んでいます…";
      results.append(loading);
      setTimeout(() => renderResults(card, input, results, limit), 120);
      return;
    }

    const matches = buildIndex(props).filter(({ key }) =>
      tokens.every((token) => key.includes(token)),
    );
    results.hidden = false;
    if (!matches.length) {
      const empty = document.createElement("p");
      empty.textContent = "該当するメンバーが見つかりません";
      results.append(empty);
      return;
    }

    matches.slice(0, limit).forEach(({ member, region }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "option");
      const name = document.createElement("strong");
      const detail = document.createElement("span");
      name.textContent = member.name;
      detail.textContent = `${member.category}｜${member.chapter}${region ? `｜${region}` : ""}`;
      button.append(name, detail);
      button.addEventListener("click", async () => {
        button.disabled = true;
        const chosen = await chooseMember(card, member, props.regionGroups);
        button.disabled = false;
        if (chosen) {
          input.value = "";
          results.hidden = true;
          results.replaceChildren();
          scheduleEnhance();
        }
      });
      results.append(button);
    });

    if (matches.length > limit) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "member-search__more";
      more.textContent = `さらに表示（残り${matches.length - limit}名）`;
      more.addEventListener("click", () =>
        renderResults(card, input, results, limit + SEARCH_PAGE_SIZE),
      );
      results.append(more);
    }
  };

  const addSearch = (card) => {
    if (card.querySelector(".member-search")) return;
    const field = document.createElement("label");
    field.className = "member-search";
    field.append("メンバー検索");

    const input = document.createElement("input");
    input.className = "member-search__input";
    input.type = "search";
    input.placeholder = "名前・カテゴリー・チャプター・リージョンで検索";
    input.autocomplete = "off";

    const results = document.createElement("div");
    results.className = "member-search__results";
    results.setAttribute("role", "listbox");
    results.hidden = true;
    const status = document.createElement("small");
    status.className = "member-search__status";
    status.setAttribute("role", "status");
    let debounce;
    input.addEventListener("input", () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => renderResults(card, input, results), 70);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") results.hidden = true;
    });
    field.append(input, results, status);
    card.querySelector(".person-card__heading")?.after(field);
  };

  const readStoredProfiles = () => {
    try {
      return JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || "{}") || {};
    } catch {
      localStorage.removeItem(PROFILE_STORAGE_KEY);
      return {};
    }
  };

  const profileKey = (sideIndex) => {
    const card = document.querySelectorAll(".person-card")[sideIndex];
    if (!card) return "";
    const selects = card.querySelectorAll("select");
    const memberId = selects[2]?.value;
    if (memberId) return memberId;
    const customName = card.querySelector(".person-name-input")?.value?.trim();
    return customName ? `visitor:${normalizePart(customName)}` : "";
  };

  const profileFields = (profileCard) => [
    ...profileCard.querySelectorAll(".profile-fallback__grid input"),
    profileCard.querySelector(".profile-fallback__note textarea"),
  ].filter(Boolean);

  const saveProfile = (sideIndex, profileCard) => {
    const key = profileKey(sideIndex);
    if (!key) return;
    const values = profileFields(profileCard).map((field) => field.value);
    const stored = readStoredProfiles();
    stored[key] = values;
    try {
      localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // 保存容量超過時も入力操作は止めない。
    }
  };

  const restoreProfile = (sideIndex, profileCard) => {
    const key = profileKey(sideIndex);
    const values = key ? readStoredProfiles()[key] : null;
    if (!values) return;
    profileFields(profileCard).forEach((field, index) => {
      if (!field.value && values[index]) setNativeValue(field, values[index]);
    });
  };

  const enhanceProfilePersistence = () => {
    document.querySelectorAll(".profile-fallback").forEach((profileCard, index) => {
      if (!profileCard.dataset.enlinkPersistence) {
        profileCard.dataset.enlinkPersistence = "true";
        profileFields(profileCard).forEach((field) =>
          field.addEventListener("input", () => saveProfile(index, profileCard)),
        );
      }
      restoreProfile(index, profileCard);
    });
  };

  const sectorRules = [
    ["デジタル・集客", /line|web|ウェブ|it|ai|dx|広告|マーケ|sns|動画|システム|デザイン|制作|印刷/i],
    ["士業・お金", /税理士|会計|保険|fp|弁護士|司法書士|行政書士|社労士|補助金|融資|金融|相続/i],
    ["住まい・不動産", /不動産|建築|工務店|住宅|リフォーム|内装|外装|電気|設備|管材|清掃|造園/i],
    ["健康・美容", /医療|歯科|薬局|整体|鍼灸|健康|美容|エステ|化粧|介護|福祉|トレーニング/i],
    ["飲食・おもてなし", /飲食|食品|料理|弁当|カフェ|酒|宿泊|ホテル|旅行|観光/i],
    ["人・学び", /教育|学校|研修|コーチ|人材|採用|キャリア|保育|スクール|講師/i],
    ["表現・イベント", /写真|映像|花|音楽|芸術|イベント|司会|ブライダル|衣装|ジュエリー/i],
    ["移動・ものづくり", /自動車|運送|物流|製造|機械|工業|修理|販売|小売|卸/i],
  ];

  const sectorOf = (category) =>
    sectorRules.find(([, pattern]) => pattern.test(category || ""))?.[0] || "専門サービス";

  const selectedMember = (card) => {
    const props = componentProps(card);
    const selects = card.querySelectorAll("select");
    const id = selects[2]?.value;
    const member = props?.members.find((item) => item.id === id);
    if (member) return member;
    const name = card.querySelector(".person-name-input")?.value?.trim();
    if (!name) return null;
    return { id: `visitor:${normalizePart(name)}`, name, category: "未入力", chapter: "ビジター" };
  };

  const profileValue = (index, fieldIndex, fallback = "") => {
    const card = document.querySelectorAll(".profile-fallback")[index];
    return card ? profileFields(card)[fieldIndex]?.value?.trim() || fallback : fallback;
  };

  const hashPair = (leftCategory, rightCategory) => {
    let value = 0;
    for (const char of `${leftCategory}:${rightCategory}`) {
      value = (value * 31 + char.charCodeAt(0)) >>> 0;
    }
    return value;
  };

  const createProposals = (left, right) => {
    const leftCategory = profileValue(0, 0, left.category) || left.category;
    const rightCategory = profileValue(1, 0, right.category) || right.category;
    const leftStrength = profileValue(0, 2);
    const rightStrength = profileValue(1, 2);
    const sameSector = sectorOf(leftCategory) === sectorOf(rightCategory);
    const classic = sameSector
      ? `${leftCategory}と${rightCategory}の近い顧客層に対し、役割が重ならない部分を分担した共同相談会や相互紹介が考えられます。競合になり得る点を先に確認すると、紹介条件を明確にできます。`
      : `${left.name}さんの「${leftCategory}」の顧客接点と、${right.name}さんの「${rightCategory}」の専門性をつなぎ、顧客の課題を前後工程でまとめて支援する共同提案が考えられます。`;

    const unusualPatterns = [
      `${leftCategory}と${rightCategory}を直接セット販売するのではなく、両者の知見を使った「異業種診断コンテンツ」を共同制作する案です。診断結果から双方への相談導線を作れば、普段は接点のない顧客にも自然に届きます。`,
      `${rightCategory}の価値を、${leftCategory}の取引先向け「福利厚生・従業員体験」に組み替える案です。BtoCのサービスでも、採用・定着・社内交流という切り口なら新しい法人需要を作れる可能性があります。`,
      `地域イベントで「${leftCategory}×${rightCategory}」の体験企画を作る案です。商品同士の近さではなく、両者が持つ顧客コミュニティを掛け合わせ、意外性そのものを集客理由にします。`,
      `お客様の誕生日・開業・移転・結婚・相続などの「節目」を共通テーマにし、${leftCategory}と${rightCategory}を一つの体験導線としてつなぐ案です。通常は別々に依頼されるサービスを、節目起点で束ねます。`,
      `両業界の顧客へ短い共同アンケートを行い、「${leftCategory}の顧客が${rightCategory}に求めること」をレポート化する案です。調査結果をセミナーや紹介の入口にすると、売り込み感を抑えながら新市場を探れます。`,
      `${leftCategory}と${rightCategory}の専門性を、地域企業向けの「困りごと相談デー」に持ち込む案です。一見離れた2業種を同席させることで、本人も気づいていない複合課題を発見し、別々の案件へ展開できます。`,
    ];
    const unusual = unusualPatterns[hashPair(leftCategory, rightCategory) % unusualPatterns.length];
    const facts = [
      leftStrength && `${left.name}さんの強み「${leftStrength}」`,
      rightStrength && `${right.name}さんの強み「${rightStrength}」`,
    ].filter(Boolean);
    const question = facts.length
      ? `${facts.join("と")}を、どの顧客層・場面で掛け合わせると価値が最大になるかを確認すると、提案を具体化できます。`
      : "それぞれの主な顧客層、顧客が相談に来るタイミング、紹介してほしい相手、提供できない領域を確認すると、王道案と意外な案のどちらが成立するか判断できます。";
    return { classic, unusual, question };
  };

  const proposalArticle = (label, title, bodyText, className = "") => {
    const article = document.createElement("article");
    article.className = className;
    const badge = document.createElement("span");
    badge.textContent = label;
    const heading = document.createElement("h4");
    heading.textContent = title;
    const body = document.createElement("p");
    body.textContent = bodyText;
    article.append(badge, heading, body);
    return article;
  };

  const enhanceCollaborationProposals = () => {
    const cards = [...document.querySelectorAll(".person-card")];
    const reasonCard = document.querySelector(".reason-card");
    if (cards.length < 2 || !reasonCard) return;
    let section = document.querySelector(".collaboration-proposals");
    const left = selectedMember(cards[0]);
    const right = selectedMember(cards[1]);
    if (!left || !right || left.id === right.id) {
      section?.remove();
      return;
    }

    if (!section) {
      section = document.createElement("section");
      section.className = "collaboration-proposals";
      section.setAttribute("aria-live", "polite");
      reasonCard.after(section);
    }
    const pairKey = `${left.id}:${right.id}:${profileValue(0, 0, left.category)}:${profileValue(1, 0, right.category)}:${profileValue(0, 2)}:${profileValue(1, 2)}`;
    if (section.dataset.pairKey === pairKey) return;
    section.dataset.pairKey = pairKey;
    const proposals = createProposals(left, right);
    const heading = document.createElement("div");
    heading.className = "collaboration-proposals__heading";
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = "COLLABORATION IDEAS";
    const title = document.createElement("h3");
    title.textContent = "この2人から期待できること";
    const note = document.createElement("small");
    note.textContent = "職種と入力内容から考えた仮説です。事実ではなく、1to1の会話を広げる提案としてご覧ください。";
    heading.append(eyebrow, title, note);
    const grid = document.createElement("div");
    grid.className = "collaboration-proposals__grid";
    grid.append(
      proposalArticle("01", "王道の連携案", proposals.classic),
      proposalArticle("02", "意外なコラボ案", proposals.unusual, "is-unusual"),
      proposalArticle("03", "1to1で確かめること", proposals.question),
    );
    section.replaceChildren(heading, grid);
  };

  const updateMetric = (props) => {
    const metric = document.querySelector(".demo-label");
    if (!props || !metric) return;
    const chapters = new Set(
      props.members.filter((member) => !member.isVisitor).map((member) => member.chapter),
    );
    const label = `${chapters.size.toLocaleString("ja-JP")}チャプター・${props.members.length.toLocaleString("ja-JP")}名登録`;
    if (metric.textContent !== label) metric.textContent = label;
  };

  const enhance = () => {
    enhanceQueued = false;
    const cards = [...document.querySelectorAll(".person-card")];
    cards.forEach(addSearch);
    updateMetric(cards[0] ? componentProps(cards[0]) : null);
    enhanceProfilePersistence();
    enhanceCollaborationProposals();
  };

  const scheduleEnhance = () => {
    if (enhanceQueued) return;
    enhanceQueued = true;
    requestAnimationFrame(enhance);
  };

  const observer = new MutationObserver(scheduleEnhance);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("change", scheduleEnhance, true);
  document.addEventListener("input", scheduleEnhance, true);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleEnhance, { once: true });
  } else {
    scheduleEnhance();
  }
})();
