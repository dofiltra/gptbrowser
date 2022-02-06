// // import { extractPageDate } from '.'
// import fetch from 'node-fetch'

import { TransType } from 'rwrsvc'
import { GptBrowser } from '.'
;(async () => {
  const browser = await GptBrowser.build<GptBrowser>(
    {
      maxOpenedBrowsers: 5
    },
    {
      transSettings: [
        {
          maxInstance: 0,
          maxPerUse: 5,
          type: TransType.DeBro,
          headless: false
        }
      ],
      wtnSettings: {
        instanceOpts: [
          {
            maxInstance: 0,
            maxPerUse: 5,
            type: 'WTN',
            headless: false
          }
        ]
      }
    }
  )

  const url = 'http://demo.lp-base.pro/0058/'
  const page = await browser?.newPage({
    url,
    waitUntil: 'domcontentloaded'
  })

  const scripts = await page?.$$('script[src]')
  const styles = await page?.$$('link[href]')

  await Promise.all(
    scripts!.map(async (script) => {
      try {
        const src = await script.getAttribute('src')
        if (src?.includes('/script.js') || src?.includes('/body.js')) {
          await script.dispose()
          return
        }

        await script.evaluate(
          async (item, { url }) => {
            const src = await script.getAttribute('src')
            if (src?.startsWith('files')) {
              item.setAttribute('src', `${url}${src}`)
            }
          },
          { url }
        )
      } catch (e) {
        console.log(e)
      }
    })
  )

  await Promise.all(
    styles!.map(async (style) => {
      try {
        await style.evaluate(
          async (item, { url }) => {
            const href = await style.getAttribute('href')
            if (href?.startsWith('files')) {
              item.setAttribute('href', `${url}${href}`)
            }
          },
          { url }
        )
      } catch (e: any) {
        console.log(e)
      }
    })
  )
  const html = await page?.content()

  debugger

  //   const resp1 = await fetch(
  //     'https://noalkogolizm.ru/news/news/2021/11/07/massovo-zaboleli-grippom-igroki-hokkeynogo-kluba-salavat-yulaev.html'
  //   )
  //   const resp2 = await fetch('https://hotnewstoday24.ru/news-today/mezhdunarodnaya-panorama/12855281')

  //   const html1 = await resp1.text()
  //   const html2 = await resp2.text()

  //   await extractPageDate(html1)
  //   await extractPageDate(html2)
})()
