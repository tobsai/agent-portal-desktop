module.exports = {
  packagerConfig: {
    name: 'Agent Portal',
    executableName: 'AgentPortal',
    appBundleId: 'io.mtree.agent-portal',
    icon: 'src/icon',
    osxSign: false,
    osxNotarize: false,
  },
  makers: [
    { name: '@electron-forge/maker-zip', platforms: ['darwin'] },
    { name: '@electron-forge/maker-dmg', config: { format: 'ULFO' } }
  ]
};
