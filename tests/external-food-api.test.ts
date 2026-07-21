import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExternalFoodApiError, externalFoodErrorMessage, searchExternalFood } from '../src/services/externalFoodApi'

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('external food API', () => {
  it('Open Food Facts v3の商品を100g基準で読み取る', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({
      status: 'success',
      result: { id: 'product_found' },
      product: {
        product_name: 'テスト飲料',
        brands: 'メーカー',
        quantity: '500 ml',
        nutriments: {
          'energy-kcal_100g': 42,
          proteins_100g: 1.2,
          calcium_100g: 0.125,
          calcium_unit: 'g',
          'vitamin-a_100g': 0.00008,
          'vitamin-a_unit': 'g',
        },
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const preview = await searchExternalFood('4901234567890', 'https://world.openfoodfacts.org/api/v3/product')

    expect(preview).toMatchObject({ name: 'テスト飲料', maker: 'メーカー', baseAmount: 100, baseUnit: 'ml' })
    expect(preview?.nutrients.calciumMg).toBe(125)
    expect(preview?.nutrients.vitaminAMcg).toBe(80)
    const [url, options] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.toString()).toContain('/4901234567890.json?fields=')
    expect((options.headers as Record<string, string>)['X-User-Agent']).toContain('nutrition-pwa')
  })

  it('旧v2形式も互換的に読み取る', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      status: 1,
      product: { product_name: '旧形式商品', quantity: '120 g', nutriments: { 'energy-kcal_100g': 100 } },
    })))

    const preview = await searchExternalFood('4901234567890', 'https://example.com/api/v2/product')
    expect(preview?.name).toBe('旧形式商品')
    expect(preview?.baseAmount).toBe(100)
  })

  it('404と商品なしレスポンスを接続エラーにしない', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({}, 404)))
    await expect(searchExternalFood('4901234567890', 'https://example.com/product')).resolves.toBeNull()

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ status: 'success', result: { id: 'product_not_found' } })))
    await expect(searchExternalFood('4901234567890', 'https://example.com/product')).resolves.toBeNull()
  })

  it('HTTP障害と通信障害を区別する', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({}, 503)))
    await expect(searchExternalFood('4901234567890', 'https://example.com/product')).rejects.toMatchObject({ kind: 'unavailable', status: 503 })

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const error = await searchExternalFood('4901234567890', 'https://example.com/product').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ExternalFoodApiError)
    expect(error).toMatchObject({ kind: 'network' })
    expect(externalFoodErrorMessage(error)).toContain('通信状態')
  })
})
