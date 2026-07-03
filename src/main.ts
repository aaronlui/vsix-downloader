import "./style.css";
import {
  buildVsixDownloadUrl,
  getExtensionVersions,
  searchExtensions,
  type ExtensionSummary,
  type ExtensionVersion,
} from "./marketplace";

interface CardState {
  summary: ExtensionSummary;
  versions: ExtensionVersion[] | null;
  selectedVersion: string;
  loadingVersions: boolean;
  error: string | null;
}

const app = document.querySelector<HTMLDivElement>("#app")!;

let searchInput: HTMLInputElement;
let searchButton: HTMLButtonElement;
let statusEl: HTMLDivElement;
let resultsEl: HTMLDivElement;

const cardStates = new Map<string, CardState>();

function extensionKey(summary: ExtensionSummary): string {
  return `${summary.publisherName}.${summary.extensionName}`;
}

function formatInstallCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`;
  }
  return String(count);
}

function setStatus(message: string, isError = false): void {
  statusEl.textContent = message;
  statusEl.className = isError ? "status error" : "status";
}

function getSelectedVersion(state: CardState): ExtensionVersion | undefined {
  return state.versions?.find((v) => v.version === state.selectedVersion);
}

function render(): void {
  app.innerHTML = `
    <header>
      <h1>VSIX 插件下载器</h1>
      <p>搜索 VS Code 插件，选择版本号，打开链接下载 .vsix 文件</p>
    </header>
    <form class="search-bar" id="search-form">
      <input
        id="search-input"
        type="search"
        placeholder="输入插件名，例如 volar、prettier、rust-analyzer"
        autocomplete="off"
      />
      <button type="submit" class="btn-primary" id="search-button">搜索</button>
    </form>
    <div class="status" id="status"></div>
    <div class="results" id="results"></div>
  `;

  searchInput = app.querySelector("#search-input")!;
  searchButton = app.querySelector("#search-button")!;
  statusEl = app.querySelector("#status")!;
  resultsEl = app.querySelector("#results")!;

  app.querySelector("#search-form")!.addEventListener("submit", (event) => {
    event.preventDefault();
    void runSearch();
  });
}

function renderResults(summaries: ExtensionSummary[]): void {
  if (summaries.length === 0) {
    resultsEl.innerHTML =
      '<div class="empty-state">未找到匹配的插件，请尝试其他关键词</div>';
    return;
  }

  resultsEl.innerHTML = summaries
    .map((summary) => {
      const key = extensionKey(summary);
      const state = cardStates.get(key);
      const versions = state?.versions;
      const selected = state?.selectedVersion ?? summary.latestVersion;
      const selectedMeta = versions?.find((v) => v.version === selected);
      const downloadUrl = buildVsixDownloadUrl(
        summary.publisherName,
        summary.extensionName,
        selected,
        selectedMeta?.targetPlatform,
      );

      const hasAllVersions = Boolean(versions);
      const versionOptions =
        state?.loadingVersions
          ? `<option>加载版本中...</option>`
          : (versions ?? [{ version: summary.latestVersion, targetPlatform: "universal", lastUpdated: "" }])
              .map((v) => {
                const label =
                  v.targetPlatform === "universal"
                    ? v.version
                    : `${v.version} (${v.targetPlatform})`;
                return `<option value="${v.version}" ${v.version === selected ? "selected" : ""}>${label}</option>`;
              })
              .join("");

      const loadVersionsButton =
        hasAllVersions || state?.loadingVersions
          ? ""
          : `<button type="button" class="btn-secondary" data-action="load-versions" data-key="${key}">获取版本列表</button>`;

      const versionError = state?.error
        ? `<div class="status error">${state.error}</div>`
        : "";

      return `
        <article class="card" data-key="${key}">
          <div class="card-header">
            ${
              summary.iconUrl
                ? `<img class="card-icon" src="${summary.iconUrl}" alt="" />`
                : `<div class="card-icon placeholder">📦</div>`
            }
            <div class="card-meta">
              <h2>${escapeHtml(summary.displayName)}</h2>
              <div class="identifier">${escapeHtml(summary.publisherName)}.${escapeHtml(summary.extensionName)}</div>
              <p class="description">${escapeHtml(summary.shortDescription)}</p>
              <div class="card-stats">
                安装量 ${formatInstallCount(summary.installCount)} ·
                最新版本 ${escapeHtml(summary.latestVersion)}
              </div>
            </div>
          </div>
          <div class="card-actions">
            ${versionError}
            <div class="version-row">
              <label for="version-${key}">版本</label>
              <select id="version-${key}" data-key="${key}" ${!hasAllVersions || state?.loadingVersions ? "disabled" : ""}>
                ${versionOptions}
              </select>
              ${loadVersionsButton}
            </div>
            <div class="url-box">
              <input type="text" readonly value="${escapeHtml(downloadUrl)}" aria-label="下载链接" />
            </div>
            <div class="action-buttons">
              <button type="button" class="btn-primary" data-action="download" data-key="${key}">打开下载链接</button>
              <button type="button" class="btn-secondary" data-action="copy" data-key="${key}">复制链接</button>
              <button type="button" class="btn-secondary" data-action="marketplace" data-key="${key}">Marketplace</button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  resultsEl.querySelectorAll("select[data-key]").forEach((select) => {
    select.addEventListener("change", (event) => {
      const target = event.target as HTMLSelectElement;
      const key = target.dataset.key!;
      const state = cardStates.get(key);
      if (!state) {
        return;
      }
      state.selectedVersion = target.value;
      cardStates.set(key, state);
      rerenderCards(getAllSummaries());
    });
  });

  resultsEl.querySelectorAll("button[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = (button as HTMLButtonElement).dataset.action;
      if (action === "load-versions") {
        const key = (button as HTMLButtonElement).dataset.key!;
        const summary = summaries.find((s) => extensionKey(s) === key);
        if (summary) {
          void loadVersions(summary);
        }
        return;
      }
      void handleCardAction(button as HTMLButtonElement, summaries);
    });
  });
}

function getAllSummaries(): ExtensionSummary[] {
  return [...cardStates.values()].map((state) => state.summary);
}

function rerenderCards(summaries: ExtensionSummary[]): void {
  renderResults(summaries);
}

async function loadVersions(summary: ExtensionSummary): Promise<void> {
  const key = extensionKey(summary);
  const current = cardStates.get(key);
  if (!current) {
    return;
  }

  cardStates.set(key, { ...current, loadingVersions: true, error: null });
  rerenderCards(getAllSummaries());

  try {
    const versions = await getExtensionVersions(
      summary.publisherName,
      summary.extensionName,
    );
    cardStates.set(key, {
      ...current,
      versions,
      selectedVersion: versions[0]?.version ?? summary.latestVersion,
      loadingVersions: false,
      error: null,
    });
  } catch (error) {
    cardStates.set(key, {
      ...current,
      loadingVersions: false,
      error: error instanceof Error ? error.message : "加载版本失败",
    });
  }

  rerenderCards(getAllSummaries());
}

async function handleCardAction(
  button: HTMLButtonElement,
  summaries: ExtensionSummary[],
): Promise<void> {
  const key = button.dataset.key!;
  const action = button.dataset.action!;
  const state = cardStates.get(key);
  const summary = summaries.find((s) => extensionKey(s) === key);
  if (!state || !summary) {
    return;
  }

  const selectedMeta = getSelectedVersion(state);
  const url = buildVsixDownloadUrl(
    summary.publisherName,
    summary.extensionName,
    state.selectedVersion,
    selectedMeta?.targetPlatform,
  );

  if (action === "download") {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  if (action === "copy") {
    await navigator.clipboard.writeText(url);
    setStatus("下载链接已复制到剪贴板");
    return;
  }

  if (action === "marketplace") {
    window.open(summary.marketplaceUrl, "_blank", "noopener,noreferrer");
  }
}

async function runSearch(): Promise<void> {
  const query = searchInput.value.trim();
  if (!query) {
    setStatus("请输入插件名称", true);
    return;
  }

  cardStates.clear();
  searchButton.disabled = true;
  setStatus(`正在搜索「${query}」...`);
  resultsEl.innerHTML = "";

  try {
    const summaries = await searchExtensions(query);
    summaries.forEach((summary) => {
      cardStates.set(extensionKey(summary), {
        summary,
        versions: null,
        selectedVersion: summary.latestVersion,
        loadingVersions: false,
        error: null,
      });
    });

    setStatus(`找到 ${summaries.length} 个插件`);
    renderResults(summaries);
  } catch (error) {
    setStatus(
      error instanceof Error ? error.message : "搜索失败，请稍后重试",
      true,
    );
  } finally {
    searchButton.disabled = false;
  }
}

function escapeHtml(value: string | null | undefined): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

render();
