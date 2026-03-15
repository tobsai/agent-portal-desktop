module.exports = {
  packagerConfig: {
    name: 'Lewis',
    executableName: 'Lewis',
    appBundleId: 'io.mtree.lewis-desktop',
    icon: 'src/icon',
    osxSign: false,
    osxNotarize: false,
  },
  makers: [
    { name: '@electron-forge/maker-zip', platforms: ['darwin'] },
    { name: '@electron-forge/maker-dmg', config: { format: 'ULFO' } }
  ]
};
