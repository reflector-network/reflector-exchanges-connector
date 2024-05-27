const Asset = require('./models/asset')

const assetsGlossary = require('./assets-glossary.json')

const assets = {}

const assetName = Object.keys(assetsGlossary)
for (const asset of assetName) {
    assets[asset] = new Asset(asset, assetsGlossary[asset])
}

/**
 * @param {string} name - asset name
 * @returns {Asset}
 */
function getAsset(name) {
    if (!assets[name])
        assets[name] = new Asset(name, [name])
    return assets[name]
}

module.exports = {getAsset}