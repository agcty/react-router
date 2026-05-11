import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  createRSCCompatibilityVersion,
  getRSCPluginApi,
  type RSCPluginApi,
} from "../vite/rsc/compatibility-version";

describe("RSC compatibility version", () => {
  let rootDirectory: string;

  beforeEach(async () => {
    rootDirectory = await mkdtemp(join(tmpdir(), "rr-rsc-version-"));
  });

  afterEach(async () => {
    await rm(rootDirectory, { recursive: true, force: true });
  });

  it("is stable when compiler reference ABI metadata is stable", async () => {
    let before = await getVersion(createApi());

    expect(await getVersion(createApi())).toBe(before);
  });

  it("does not change when client implementation-only metadata changes", async () => {
    let before = await getVersion(
      createApi({
        clientReferenceMetaMap: {
          "/app/components/button.tsx": clientReference({
            importId: "/app/components/button.tsx",
            referenceKey: "button",
            renderedExports: ["Button"],
          }),
        },
      }),
    );

    expect(
      await getVersion(
        createApi({
          clientReferenceMetaMap: {
            "/app/components/button.tsx": clientReference({
              importId: "/app/components/button.tsx",
              referenceKey: "button",
              renderedExports: ["Button"],
              exportNames: ["Button", "UnusedImplementationDetail"],
            }),
          },
        }),
      ),
    ).toBe(before);
  });

  it("changes when a rendered client export changes", async () => {
    let before = await getVersion(
      createApi({
        clientReferenceMetaMap: {
          "/app/components/card.tsx": clientReference({
            importId: "/app/components/card.tsx",
            referenceKey: "card",
            renderedExports: ["Card"],
          }),
        },
      }),
    );

    expect(
      await getVersion(
        createApi({
          clientReferenceMetaMap: {
            "/app/components/card.tsx": clientReference({
              importId: "/app/components/card.tsx",
              referenceKey: "card",
              renderedExports: ["Card", "CardHeader"],
            }),
          },
        }),
      ),
    ).not.toBe(before);
  });

  it("changes when a client reference is added", async () => {
    let before = await getVersion(createApi());

    expect(
      await getVersion(
        createApi({
          clientReferenceMetaMap: {
            "/app/components/dialog.tsx": clientReference({
              importId: "/app/components/dialog.tsx",
              referenceKey: "dialog",
              renderedExports: ["Dialog"],
            }),
          },
        }),
      ),
    ).not.toBe(before);
  });

  it("changes when a server reference ABI changes", async () => {
    let before = await getVersion(
      createApi({
        serverReferenceMetaMap: {
          "/app/actions.ts": serverReference({
            importId: "/app/actions.ts",
            referenceKey: "actions",
            exportNames: ["save"],
          }),
        },
      }),
    );

    expect(
      await getVersion(
        createApi({
          serverReferenceMetaMap: {
            "/app/actions.ts": serverReference({
              importId: "/app/actions.ts",
              referenceKey: "actions",
              exportNames: ["delete", "save"],
            }),
          },
        }),
      ),
    ).not.toBe(before);
  });

  it("changes when server action encryption is build-versioned", async () => {
    let api = createApi({
      serverReferenceMetaMap: {
        "/app/actions.ts": serverReference({
          importId: "/app/actions.ts",
          referenceKey: "actions",
          exportNames: ["save"],
        }),
      },
    });
    let before = await getVersion(api, {
      serverActionEncryptionSalt: "build-a",
    });

    expect(
      await getVersion(api, {
        serverActionEncryptionSalt: "build-b",
      }),
    ).not.toBe(before);
  });

  it("normalizes absolute ids relative to the Vite root", async () => {
    let before = await getVersion(
      createApi({
        root: "/first/root",
        clientReferenceMetaMap: {
          "/first/root/app/button.tsx": clientReference({
            importId: "/first/root/app/button.tsx",
            referenceKey: "button",
            renderedExports: ["Button"],
          }),
        },
      }),
    );

    expect(
      await getVersion(
        createApi({
          root: "/second/root",
          clientReferenceMetaMap: {
            "/second/root/app/button.tsx": clientReference({
              importId: "/second/root/app/button.tsx",
              referenceKey: "button",
              renderedExports: ["Button"],
            }),
          },
        }),
      ),
    ).toBe(before);
  });

  it("reads the plugin-rsc api from the Vite plugin list", () => {
    let api = createApi();

    return expect(
      getRSCPluginApi({
        plugins: [{ name: "other" }, { name: "rsc:minimal", api }],
      }),
    ).resolves.toBe(api);
  });

  async function getVersion(
    rscPluginApi: RSCPluginApi,
    options: {
      serverActionEncryptionSalt?: string;
    } = {},
  ) {
    return await createRSCCompatibilityVersion({
      getPackageVersion: async (packageName) => `${packageName}@1.0.0`,
      rootDirectory,
      rscPluginApi,
      serverActionEncryptionSalt: options.serverActionEncryptionSalt,
    });
  }
});

function createApi({
  base = "/",
  clientReferenceMetaMap = {},
  root = "/app",
  serverReferenceMetaMap = {},
}: {
  base?: string;
  clientReferenceMetaMap?: RSCPluginApi["manager"]["clientReferenceMetaMap"];
  root?: string;
  serverReferenceMetaMap?: RSCPluginApi["manager"]["serverReferenceMetaMap"];
} = {}): RSCPluginApi {
  return {
    manager: {
      config: {
        base,
        root,
      },
      clientReferenceMetaMap,
      serverReferenceMetaMap,
      toRelativeId(id) {
        return id.startsWith(root) ? id.slice(root.length + 1) : id;
      },
    },
  };
}

function clientReference({
  importId,
  packageSource,
  referenceKey,
  renderedExports,
  exportNames = renderedExports,
}: {
  exportNames?: string[];
  importId: string;
  packageSource?: string;
  referenceKey: string;
  renderedExports: string[];
}): RSCPluginApi["manager"]["clientReferenceMetaMap"][string] {
  let meta: RSCPluginApi["manager"]["clientReferenceMetaMap"][string] = {
    importId,
    referenceKey,
    exportNames,
    renderedExports,
  };
  if (packageSource) {
    meta.packageSource = packageSource;
  }
  return meta;
}

function serverReference({
  exportNames,
  importId,
  referenceKey,
}: {
  exportNames: string[];
  importId: string;
  referenceKey: string;
}): RSCPluginApi["manager"]["serverReferenceMetaMap"][string] {
  return {
    importId,
    referenceKey,
    exportNames,
  };
}
