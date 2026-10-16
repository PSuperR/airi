import type { ExtensionManifestV2 } from '@proj-airi/plugin-sdk/plugin-host'

export const stageControlManifest = {
  manifestVersion: 2,
  kind: 'manifest.extension.airi.moeru.ai',
  id: 'airi-plugin-stage-control',
  version: '1.0.0',
  engines: {
    airi: '*',
    runtimes: ['electron'],
  },
  entrypoints: {
    electron: './src/index.ts',
  },
  permissions: {
    apis: [
      {
        key: 'kit.stage',
        actions: ['invoke'],
      },
    ],
  },
  kits: {
    uses: [
      {
        id: 'kit.stage',
        version: '1.0.0',
      },
    ],
  },
} satisfies ExtensionManifestV2
