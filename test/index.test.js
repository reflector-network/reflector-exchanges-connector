/*eslint-disable no-undef */
const fs = require('fs')
const {setProxy, getTradesData} = require('../src')
const {assets, getTimestamp} = require('./test-utils')

const data = []
const proxies = [
    'socks5://user-reflector_30hMu:feVy7KQXyzNe@ddc.oxylabs.io:8001',
    'socks5://user-reflector_30hMu:feVy7KQXyzNe@ddc.oxylabs.io:8002',
    'socks5://user-reflector_30hMu:feVy7KQXyzNe@ddc.oxylabs.io:8003'
]

describe('index', () => {
    beforeAll(() => {
        console.log = (...args) => {
            data.push(args)
        }
        console.error = (...args) => {
            data.push(args)
        }
        console.warn = (...args) => {
            data.push(args)
        }
        console.info = (...args) => {
            data.push(args)
        }
        console.debug = (...args) => {
            data.push(args)
        }
        jest.setTimeout(60000)
    })

    tradesData = []
    const timeframe = 60
    const count = 100
    const timestamp = getTimestamp() - (timeframe * count)

    it('get prices', async () => {
        tradesData = await getTradesData(assets, 'USD', timestamp, timeframe, count, {batchSize: 5, batchDelay: 1000, timeout: 3000, sources: ['binance', 'bybit', 'kraken', 'gate', 'okx', 'coinbase']})
        expect(tradesData.length).toBe(assets.length)
    }, 30000)


    it('get prices with proxy', async () => {
        setProxy(proxies, true)
        const newTradesData = await getTradesData(assets, 'USD', timestamp, timeframe, count, {batchSize: 10, batchDelay: 1000, timeout: 3000, sources: ['binance', 'bybit', 'kraken', 'gate', 'okx', 'coinbase']})
        expect(newTradesData.length).toBe(assets.length)
        setProxy(null)
        expect(newTradesData.length).toBe(tradesData.length)
        for (let i = 0; i < tradesData.length; i++) {
            const currentAssetTrades = tradesData[i]
            const newCurrentAssetTrades = newTradesData[i]
            expect(newCurrentAssetTrades.length).toBe(currentAssetTrades.length)
            for (let j = 0; j < currentAssetTrades.length; j++) {
                const providerTrades = currentAssetTrades[j]
                const newProviderTrades = newCurrentAssetTrades[j]
                expect(newProviderTrades.length).toBe(providerTrades.length)
                for (let c = 0; c < providerTrades.length; c++) {
                    const trade = providerTrades[c]
                    const newTrade = newProviderTrades[c]
                    expect(newTrade.source).toBe(trade.source)
                    expect(newTrade.volume).toBe(trade.volume)
                    expect(newTrade.quoteVolume).toBe(trade.quoteVolume)
                }
            }
        }
    }, 30000)

    afterAll(() => {
        const log = JSON.stringify(data, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2)
        fs.writeFileSync('index.log', log)
    })
})