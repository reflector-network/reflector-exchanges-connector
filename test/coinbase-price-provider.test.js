/*eslint-disable no-undef */
const CoinbasePriceProvider = require('../src/providers/coinbase-price-provider')
const {getPriceTest, loadMarkets, pairs} = require('./test-utils')

const provider = new CoinbasePriceProvider()

describe('CoinbasePriceProvider', () => {
    it('load markets', async () => {
        await loadMarkets(provider)
    })

    it('get price', async () => {
        await getPriceTest(provider, pairs.normalPair)
    })

    it('get price for inverted pair', async () => {
        await getPriceTest(provider, pairs.invertedPair)
    })

    it('get price for invalid pair', async () => {
        await getPriceTest(provider, pairs.invalidPair, 5, true)
    })
})