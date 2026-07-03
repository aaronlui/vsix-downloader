const API_URL =
  "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery";

const HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json;api-version=3.0-preview.1",
};

/** 搜索列表：仅最新版本，响应更快 */
const SEARCH_FLAGS = 914;
/** 详情查询：包含全部历史版本 */
const DETAIL_FLAGS = 402;

export interface ExtensionVersion {
  version: string;
  targetPlatform: string;
  lastUpdated: string;
}

export interface ExtensionSummary {
  publisherName: string;
  extensionName: string;
  displayName: string;
  shortDescription: string;
  installCount: number;
  iconUrl: string;
  marketplaceUrl: string;
  latestVersion: string;
}

interface RawExtension {
  publisher?: { publisherName?: string };
  extensionName?: string;
  displayName?: string;
  shortDescription?: string | null;
  statistics?: Array<{ statisticName: string; value: number }>;
  versions: Array<{
    version: string;
    lastUpdated: string;
    files?: Array<{ assetType: string; source: string }>;
    properties?: Array<{ key: string; value: string }>;
  }>;
}

function getTargetPlatform(
  properties: Array<{ key: string; value: string }> = [],
): string {
  const platform = properties.find(
    (p) => p.key === "Microsoft.VisualStudio.Code.TargetPlatform",
  );
  return platform?.value || "universal";
}

function getInstallCount(statistics: RawExtension["statistics"]): number {
  return (
    statistics?.find((s) => s.statisticName === "install")?.value ?? 0
  );
}

function getIconUrl(versions: RawExtension["versions"]): string {
  const icon = versions[0]?.files?.find(
    (f) => f.assetType === "Microsoft.VisualStudio.Services.Icons.Default",
  );
  return icon?.source ?? "";
}

function text(value: string | null | undefined, fallback = ""): string {
  return value ?? fallback;
}

function mapSummary(ext: RawExtension): ExtensionSummary {
  const publisherName = text(ext.publisher?.publisherName, "unknown");
  const extensionName = text(ext.extensionName, "unknown");
  return {
    publisherName,
    extensionName,
    displayName: text(ext.displayName, extensionName),
    shortDescription: text(ext.shortDescription),
    installCount: getInstallCount(ext.statistics),
    iconUrl: getIconUrl(ext.versions),
    marketplaceUrl: `https://marketplace.visualstudio.com/items?itemName=${publisherName}.${extensionName}`,
    latestVersion: ext.versions[0]?.version ?? "",
  };
}

function mapVersions(ext: RawExtension): ExtensionVersion[] {
  return ext.versions.map((v) => ({
    version: v.version,
    targetPlatform: getTargetPlatform(v.properties),
    lastUpdated: v.lastUpdated,
  }));
}

async function queryExtensions(
  criteria: Array<{ filterType: number; value: string }>,
  flags: number,
  pageSize: number,
): Promise<RawExtension[]> {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      filters: [
        {
          criteria: [
            ...criteria,
            { filterType: 8, value: "Microsoft.VisualStudio.Code" },
          ],
          pageNumber: 1,
          pageSize,
          sortBy: 0,
          sortOrder: 0,
        },
      ],
      assetTypes: [],
      flags,
    }),
  });

  if (!response.ok) {
    throw new Error(`Marketplace API 请求失败 (${response.status})`);
  }

  const data = (await response.json()) as {
    results: Array<{ extensions: RawExtension[] }>;
  };

  return data.results[0]?.extensions ?? [];
}

export async function searchExtensions(
  query: string,
): Promise<ExtensionSummary[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const extensions = await queryExtensions(
    [{ filterType: 10, value: trimmed }],
    SEARCH_FLAGS,
    50,
  );

  return extensions.map(mapSummary);
}

export async function getExtensionVersions(
  publisherName: string,
  extensionName: string,
): Promise<ExtensionVersion[]> {
  const extensions = await queryExtensions(
    [{ filterType: 7, value: `${publisherName}.${extensionName}` }],
    DETAIL_FLAGS,
    1,
  );

  const ext = extensions[0];
  if (!ext) {
    throw new Error("未找到该插件");
  }

  return mapVersions(ext);
}

export function buildVsixDownloadUrl(
  publisherName: string,
  extensionName: string,
  version: string,
  targetPlatform = "universal",
): string {
  const base = `https://marketplace.visualstudio.com/_apis/public/gallery/publishers/${encodeURIComponent(publisherName)}/vsextensions/${encodeURIComponent(extensionName)}/${encodeURIComponent(version)}/vspackage`;

  if (targetPlatform && targetPlatform !== "universal") {
    return `${base}?targetPlatform=${encodeURIComponent(targetPlatform)}`;
  }

  return base;
}
