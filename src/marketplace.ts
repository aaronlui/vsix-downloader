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
/** 仅含 VersionProperties，用于从全量历史中定位最新正式版 */
const RELEASE_LOOKUP_FLAGS = 16;

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

function isPreRelease(
  properties: Array<{ key: string; value: string }> = [],
): boolean {
  return properties.some(
    (p) =>
      p.key === "Microsoft.VisualStudio.Code.PreRelease" &&
      p.value === "true",
  );
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
  const latestRelease =
    ext.versions.find((v) => !isPreRelease(v.properties)) ?? ext.versions[0];
  return {
    publisherName,
    extensionName,
    displayName: text(ext.displayName, extensionName),
    shortDescription: text(ext.shortDescription),
    installCount: getInstallCount(ext.statistics),
    iconUrl: getIconUrl(ext.versions),
    marketplaceUrl: `https://marketplace.visualstudio.com/items?itemName=${publisherName}.${extensionName}`,
    latestVersion: latestRelease?.version ?? "",
  };
}

function mapVersions(ext: RawExtension): ExtensionVersion[] {
  return ext.versions
    .filter((v) => !isPreRelease(v.properties))
    .map((v) => ({
      version: v.version,
      targetPlatform: getTargetPlatform(v.properties),
      lastUpdated: v.lastUpdated,
    }));
}

async function getLatestReleaseVersion(
  publisherName: string,
  extensionName: string,
): Promise<string | undefined> {
  const extensions = await queryExtensions(
    [{ filterType: 7, value: `${publisherName}.${extensionName}` }],
    RELEASE_LOOKUP_FLAGS,
    1,
  );
  return extensions[0]?.versions.find((v) => !isPreRelease(v.properties))
    ?.version;
}

function hasOnlyPreReleaseVersions(ext: RawExtension): boolean {
  return (
    ext.versions.length > 0 &&
    ext.versions.every((v) => isPreRelease(v.properties))
  );
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

  // 搜索接口只返回绝对最新版；若是预发布，再查一次拿到最新正式版
  return Promise.all(
    extensions.map(async (ext) => {
      const summary = mapSummary(ext);
      if (!hasOnlyPreReleaseVersions(ext)) {
        return summary;
      }

      const release = await getLatestReleaseVersion(
        summary.publisherName,
        summary.extensionName,
      );
      if (release) {
        summary.latestVersion = release;
      }
      return summary;
    }),
  );
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
