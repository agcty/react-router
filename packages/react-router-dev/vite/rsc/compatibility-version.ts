import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { relative, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import type { ResolvedConfig } from "vite";

const RSC_COMPATIBILITY_RUNTIME_PACKAGES = [
  "@vitejs/plugin-rsc",
  "react",
  "react-dom",
  "react-router",
  "react-server-dom-webpack",
  "vite",
];

export const RSC_COMPATIBILITY_VERSION_PLACEHOLDER =
  "__react_router_rsc_compatibility_version__";

type ClientReferenceMeta = {
  importId: string;
  referenceKey: string;
  packageSource?: string;
  exportNames: string[];
  renderedExports?: string[];
};

type ServerReferenceMeta = {
  importId: string;
  referenceKey: string;
  exportNames: string[];
};

export type RSCPluginApi = {
  manager: {
    config?: {
      base?: string;
      root?: string;
    };
    clientReferenceMetaMap: Record<string, ClientReferenceMeta>;
    serverReferenceMetaMap: Record<string, ServerReferenceMeta>;
    toRelativeId?: (id: string) => string;
  };
};

export async function createRSCCompatibilityVersion({
  getPackageVersion = readPackageVersion,
  rootDirectory,
  rscPluginApi,
  serverActionEncryptionSalt,
}: {
  getPackageVersion?: (
    packageName: string,
    rootDirectory: string,
  ) => Promise<string>;
  rootDirectory: string;
  rscPluginApi: RSCPluginApi;
  serverActionEncryptionSalt?: string;
}): Promise<string> {
  let hash = createHash("sha256");
  let manager = rscPluginApi.manager;

  addHashValue(hash, "schema", "react-router-rsc-compatibility-version-v2");
  addHashValue(hash, "base", manager.config?.base ?? "");
  addHashValue(
    hash,
    "server-action-encryption",
    serverActionEncryptionSalt ?? "",
  );

  for (let packageName of RSC_COMPATIBILITY_RUNTIME_PACKAGES) {
    addHashValue(
      hash,
      `package:${packageName}`,
      await getPackageVersion(packageName, rootDirectory),
    );
  }

  addHashJSON(
    hash,
    "client-references",
    Object.values(manager.clientReferenceMetaMap)
      .map((meta) => ({
        importId: normalizeReferenceId(meta.importId, manager, rootDirectory),
        packageSource: meta.packageSource,
        referenceKey: meta.referenceKey,
        renderedExports: sortStrings(meta.renderedExports ?? []),
      }))
      .sort(compareClientReferences),
  );

  addHashJSON(
    hash,
    "server-references",
    Object.values(manager.serverReferenceMetaMap)
      .map((meta) => ({
        importId: normalizeReferenceId(meta.importId, manager, rootDirectory),
        referenceKey: meta.referenceKey,
        exportNames: sortStrings(meta.exportNames),
      }))
      .sort(compareServerReferences),
  );

  return hash.digest("hex").slice(0, 16);
}

export async function getRSCPluginApi(viteConfig: {
  plugins: ReadonlyArray<{ name?: string; api?: unknown }>;
}): Promise<RSCPluginApi | undefined> {
  try {
    let { getPluginApi } = await import("@vitejs/plugin-rsc");
    let rscPluginApi = getPluginApi(
      viteConfig as unknown as Pick<ResolvedConfig, "plugins">,
    );
    if (rscPluginApi) {
      return rscPluginApi as RSCPluginApi;
    }
  } catch {}

  return viteConfig.plugins.find((plugin) => plugin.name === "rsc:minimal")
    ?.api as RSCPluginApi | undefined;
}

function addHashValue(
  hash: ReturnType<typeof createHash>,
  key: string,
  value: string,
) {
  hash.update(`\n${key}:`);
  hash.update(value);
}

function addHashJSON(
  hash: ReturnType<typeof createHash>,
  key: string,
  value: unknown,
) {
  addHashValue(hash, key, JSON.stringify(value));
}

function normalizeReferenceId(
  id: string,
  manager: RSCPluginApi["manager"],
  rootDirectory: string,
) {
  if (isBareSpecifier(id)) {
    return id;
  }

  let relativeId =
    manager.toRelativeId?.(id) ??
    relative(manager.config?.root ?? rootDirectory, id);

  return relativeId.split("\\").join("/");
}

function compareClientReferences(
  a: {
    importId: string;
    packageSource?: string;
    referenceKey: string;
    renderedExports: string[];
  },
  b: {
    importId: string;
    packageSource?: string;
    referenceKey: string;
    renderedExports: string[];
  },
) {
  return (
    a.referenceKey.localeCompare(b.referenceKey) ||
    a.importId.localeCompare(b.importId) ||
    (a.packageSource ?? "").localeCompare(b.packageSource ?? "")
  );
}

function compareServerReferences(
  a: {
    importId: string;
    referenceKey: string;
    exportNames: string[];
  },
  b: {
    importId: string;
    referenceKey: string;
    exportNames: string[];
  },
) {
  return (
    a.referenceKey.localeCompare(b.referenceKey) ||
    a.importId.localeCompare(b.importId)
  );
}

function sortStrings(values: string[]) {
  return [...values].sort();
}

function isBareSpecifier(id: string) {
  return !id.startsWith("/") && !id.startsWith(".") && !id.includes(":");
}

async function readPackageVersion(
  packageName: string,
  rootDirectory: string,
): Promise<string> {
  let packageJsonPath = resolvePackageJson(packageName, rootDirectory);
  if (packageJsonPath == null) {
    return "unknown";
  }

  let packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  return typeof packageJson.version === "string"
    ? packageJson.version
    : "unknown";
}

function resolvePackageJson(
  packageName: string,
  rootDirectory: string,
): string | null {
  let require = createRequire(resolve(rootDirectory, "package.json"));
  try {
    return require.resolve(`${packageName}/package.json`, {
      paths: [rootDirectory],
    });
  } catch {
    return null;
  }
}
