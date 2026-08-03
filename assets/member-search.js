(() => {
  const normalize = (value) =>
    String(value ?? "")
      .normalize("NFKC")
      .toLocaleLowerCase("ja-JP")
      .replace(/\s+/g, " ")
      .trim();

  const componentProps = (card) => {
    const fiberKey = Object.keys(card).find((key) =>
      key.startsWith("__reactFiber$"),
    );
    let fiber = fiberKey ? card[fiberKey] : null;
    while (fiber) {
      const props = fiber.memoizedProps;
      if (Array.isArray(props?.members) && Array.isArray(props?.regionGroups)) {
        return props;
      }
      fiber = fiber.return;
    }
    return null;
  };

  const setSelectValue = (select, value) => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    )?.set;
    setter?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const waitFor = (check, attempts = 40) =>
    new Promise((resolve) => {
      const tick = () => {
        const result = check();
        if (result || attempts-- <= 0) return resolve(result);
        requestAnimationFrame(tick);
      };
      tick();
    });

  const chooseMember = async (card, member, regionGroups) => {
    const group = regionGroups.find((item) =>
      item.chapters.includes(member.chapter),
    );
    const selects = () => card.querySelectorAll("select");
    if (!group || selects().length < 3) return;

    setSelectValue(selects()[0], group.label);
    await waitFor(() =>
      [...(selects()[1]?.options ?? [])].some(
        (option) => option.value === member.chapter,
      ),
    );
    setSelectValue(selects()[1], member.chapter);
    await waitFor(() =>
      [...(selects()[2]?.options ?? [])].some(
        (option) => option.value === member.id,
      ),
    );
    setSelectValue(selects()[2], member.id);
  };

  const renderResults = (card, input, results) => {
    const props = componentProps(card);
    const query = normalize(input.value);
    results.replaceChildren();
    if (!props || !query) {
      results.hidden = true;
      return;
    }

    const matches = props.members
      .filter((member) =>
        normalize(
          `${member.name} ${member.category} ${member.chapter}`,
        ).includes(query),
      )
      .slice(0, 50);

    results.hidden = false;
    if (!matches.length) {
      const empty = document.createElement("p");
      empty.textContent = "該当するメンバーが見つかりません";
      results.append(empty);
      return;
    }

    matches.forEach((member) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "option");
      const name = document.createElement("strong");
      const detail = document.createElement("span");
      name.textContent = member.name;
      detail.textContent = `${member.category}｜${member.chapter}`;
      button.append(name, detail);
      button.addEventListener("click", async () => {
        await chooseMember(card, member, props.regionGroups);
        input.value = "";
        results.hidden = true;
        results.replaceChildren();
      });
      results.append(button);
    });

    if (matches.length === 50) {
      const note = document.createElement("small");
      note.textContent = "検索結果の先頭50名を表示しています";
      results.append(note);
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
    input.placeholder = "名前・カテゴリー・チャプターで検索";
    input.autocomplete = "off";

    const results = document.createElement("div");
    results.className = "member-search__results";
    results.setAttribute("role", "listbox");
    results.hidden = true;
    input.addEventListener("input", () => renderResults(card, input, results));
    field.append(input, results);
    card.querySelector(".person-card__heading")?.after(field);
  };

  const enhance = () => {
    if (!document.documentElement) return;
    const cards = [...document.querySelectorAll(".person-card")];
    cards.forEach(addSearch);
    const props = cards[0] ? componentProps(cards[0]) : null;
    const metric = document.querySelector(".demo-label");
    if (props && metric) {
      const chapters = new Set(
        props.members.filter((member) => !member.isVisitor).map((member) => member.chapter),
      );
      const label = `${chapters.size.toLocaleString("ja-JP")}チャプター・${props.members.length.toLocaleString("ja-JP")}名登録`;
      if (metric.textContent !== label) metric.textContent = label;
    }
  };

  const observer = new MutationObserver(enhance);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", enhance, { once: true });
  } else {
    enhance();
  }
})();
