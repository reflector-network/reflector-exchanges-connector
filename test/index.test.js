/*eslint-disable no-undef */
const fs = require('fs')
const {setGateway, getTradesData} = require('../src')
const {assets, getTimestamp} = require('./test-utils')

const data = []
const proxies = [
    'http://localhost:8081',
    'http://localhost:8082'
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
        expect(tradesData.length).toBe(count)
        expect(tradesData[0].length).toBe(assets.length)
    }, 30000)


    it('get prices with gateway', async () => {
        setGateway(proxies, true)
        const newTradesData = await getTradesData(assets, 'USD', timestamp, timeframe, count, {batchSize: 10, batchDelay: 1000, timeout: 3000, sources: ['binance', 'bybit', 'kraken', 'gate', 'okx', 'coinbase']})
        expect(newTradesData.length).toBe(count)
        setGateway(null)
        expect(newTradesData[0].length).toBe(tradesData[0].length)
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