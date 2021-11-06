/* tslint:disable:prefer-const */
/* tslint:disable:no-empty */
/* tslint:disable:no-shadowed-variable */
/* tslint:disable:only-arrow-functions */
/* tslint:disable:forin */
/* tslint:disable:no-unused-expression */
/* tslint:disable:prefer-for-of */
/* tslint:disable:comment-format */
/* tslint:disable:no-unused-expression */

import _ from 'lodash'
import jsdom from 'jsdom'
// import cheerio from 'cheerio'

import { Readability } from '@mozilla/readability'
import { Page, ElementHandle, BrowserManager } from 'browser-manager'
import {
  TAcceptorInfo,
  TCleanOpts,
  TCustoms,
  TDonor,
  TNreadOpts,
  TRemoverEl,
  TRemovers,
  TReplacers,
  TRewriteOpts
} from 'dprx-types'

import { removeTags, replaceCustoms, replaceHtml } from './managers/cleaning'
import { RewriteSvc, TDeeplSettings, TWtnSettings } from 'rwrsvc'
import { reTryCatch } from 'esm-requirer'
import { getMicroSplits } from 'split-helper'
import { TemplateDarkBootstrap } from 'page-templator'
import { extractSelectorValue } from './managers/extractors'
import { TBrowserOpts } from 'browser-manager/lib/types'

const { JSDOM } = jsdom

const logTg = (...args: any[]) => {}

export type TContentSettings = {
  url: string
  donor?: TDonor
  acceptor: TAcceptorInfo
  html?: string
  removers?: TRemovers
  replacers?: TReplacers
  customs?: TCustoms
  isFlasher?: boolean
  rewriteOpts?: TRewriteOpts
}

export type TDependSettings = {
  deeplSettings?: TDeeplSettings
  wtnSettings?: TWtnSettings
}

export class GptBrowser extends BrowserManager {
  private static wtnSettings?: TWtnSettings
  private static deeplSettings?: TDeeplSettings

  static async build<T>(browserOpts: TBrowserOpts, dependOpts?: TDependSettings): Promise<T | null> {
    GptBrowser.wtnSettings = dependOpts?.wtnSettings
    GptBrowser.deeplSettings = dependOpts?.deeplSettings

    return super.build(browserOpts)
  }

  async getContent({
    donor,
    acceptor,
    url,
    html,
    removers,
    replacers,
    customs,
    isFlasher,
    rewriteOpts
  }: TContentSettings) {
    this.lockClose(60)

    const { virtualPath, nReadOpts, cleanOpts } = { ...donor }
    const page = await this.newPage({
      url: (!html && url) || '',
      waitUntil: 'domcontentloaded'
    })

    if (!page) {
      return { content: html }
    }

    await this.blockRequest(page, removers)

    html?.length &&
      (await page.setContent(html, {
        waitUntil: 'domcontentloaded'
      }))

    const cleanHtml = await removeTags(await page.content(), cleanOpts, removers)
    await page.setContent(cleanHtml, {
      waitUntil: 'domcontentloaded'
    })

    await this.executeFlasher(page, !!isFlasher)
    await this.removeComments(page)
    // await this.removeHtml(page, cleanOpts, removers)
    // await this.removeScripts(page, cleanOpts, removers, url)
    await this.replaceDomain(page, donor?.domain, virtualPath)
    await this.applyImages(page, donor?.domain, acceptor?.domain)
    await this.rewrite(page, rewriteOpts)

    let { title, descr, h1, content } = await this.extractPageInfo(
      page,
      url,
      nReadOpts,
      donor?.domain,
      acceptor?.domain
    )

    if (url.indexOf('?amp') === -1) {
      content = await replaceHtml(content, cleanOpts, replacers)
    }
    content = (await replaceCustoms(content, customs)) || content
    content = content?.replaceAll('\n', ' ')

    await page?.close()
    this.lockClose()
    return { title, descr, h1, content }
  }

  async rewrite(page: Page, rewriteOpts?: TRewriteOpts) {
    if (!rewriteOpts?.coefWtn) {
      return
    }

    const threadsCount = GptBrowser.wtnSettings?.browserOpts?.maxOpenedBrowsers || 1

    try {
      const { coefWtn = _.random(true), selectors = ['p'] } = rewriteOpts

      for await (const sel of selectors) {
        try {
          const els = await page.$$(sel)
          let i = 0

          while (i < els.length) {
            this.lockClose(300 * threadsCount)
            await Promise.all(els.splice(i, i + threadsCount).map(async (el) => await this.rewriteElement(el, coefWtn)))
            i += threadsCount
          }
        } catch {}
      }
    } catch {}

    this.lockClose()
  }

  async getRewritedResult(text: string, coefWtn: number) {
    this.lockClose(6e5)

    try {
      const rewritedResult = await new RewriteSvc({
        deeplSettings: GptBrowser.deeplSettings,
        wtnSettings: GptBrowser.wtnSettings
      }).rewrite({
        text,
        coefWtn
      })
      return rewritedResult
    } catch (err: any) {
      this.lockClose()
      return { text: '', err }
    }
  }

  async canBeRewrite(el: ElementHandle<SVGElement | HTMLElement>, innerText: string) {
    if (!innerText || innerText.trim().length < 50) {
      // logTg(`\nlength < 50 await el.innerHTML()`)
      return false
    }

    const hasChildNodes = await el.evaluate((e) => {
      return e.childElementCount !== 0
    })
    if (hasChildNodes) {
      // logTg(`\nhasChildNodes  ${await el.innerHTML()}`)
      return false
    }

    const microSplits = getMicroSplits(innerText, 0, '. ').filter((x) => x && x.trim())
    if (microSplits.length <= 1) {
      return false
    }

    return true
  }

  async applyImages(page: Page, donorDomain?: string, acceptorDomain?: string) {
    this.lockClose(60)

    try {
      const els = await page.$$('img')
      for (const el of els) {
        try {
          this.lockClose(10)
          await el.evaluate(
            (e, { donorDomain, acceptorDomain }) => {
              e.setAttribute('loading', 'lazy')
              e.setAttribute('decoding', 'async')
              e.classList.add('img-fluid')

              if (e.srcset) {
                if (e.srcset.indexOf('base64') > -1) {
                  e.removeAttribute('srcset')
                } else if (donorDomain && acceptorDomain) {
                  e.srcset = e.srcset.replaceAll(donorDomain, acceptorDomain)
                }
              }
            },
            {
              donorDomain,
              acceptorDomain
            }
          )
        } catch {}
      }
    } catch {}

    this.lockClose()
  }

  async executeFlasher(page: Page, isFlasher: boolean) {
    if (!isFlasher) {
      return
    }

    this.lockClose(60)
    reTryCatch({
      fn: async () => {
        const els = await page.$$('a')
        for (const el of els) {
          try {
            this.lockClose(10)
            await el.evaluate((elem) => {
              elem.removeAttribute('href')
              elem.removeAttribute('onclick')
            })
          } catch {}
        }
      }
    })

    this.lockClose()
  }

  async blockRequest(page: Page, removers?: TRemovers) {
    const blocklist =
      removers?.scripts
        ?.map((x: TRemoverEl) => extractSelectorValue(x.selectorItem?.selector))
        .filter((x) => x.length) || []

    if (!blocklist.length) {
      return
    }

    await page.route('**/*', (route) => {
      const req = route.request()

      if (blocklist.some((regex?: string) => req.url().match(regex!))) {
        return route.abort()
      }
      return route.continue()
    })
  }

  async removeComments(page: Page) {
    this.lockClose(10)
    try {
      await page.evaluate(() => {
        const findComments = function (el: ChildNode | Document) {
          const arr = []
          for (let i = 0; i < el.childNodes.length; i++) {
            const node = el.childNodes[i]
            if (node.nodeType === 8) {
              arr.push(node)
            } else {
              arr.push.apply(arr, findComments(node))
            }
          }
          return arr
        }

        const commentNodes = findComments(document)
        commentNodes.forEach((c: ChildNode) => c.remove())
      })
    } catch (e: any) {
      logTg(e)
    }

    this.lockClose()
  }

  async replaceDomain(page: Page, donorDomain: string = '', virtualPath: string = '') {
    if (!virtualPath && !donorDomain) {
      return page
    }
    this.lockClose(60)

    const attrsReplace: any = {
      href: ['a', 'link'],
      src: ['script', 'img', 'iframe', 'amp-img'],
      srcset: ['img'],
      content: ['meta'],
      action: ['form']
    }

    for (const attrName in attrsReplace) {
      const tagNames = attrsReplace[attrName]
      try {
        for (const tagname of tagNames) {
          const els = await page.$$(tagname)
          await this.replaceDomainAttr(els, attrName, virtualPath, donorDomain)
        }
      } catch (e: any) {
        logTg(`${e}\n ${attrName}`)
      }
    }

    this.lockClose()
  }

  private async replaceDomainAttr(els: ElementHandle<any>[], attr: string, virtualPath: string, donorDomain: string) {
    this.lockClose(60)
    const donorUrl = new URL(donorDomain)

    try {
      for (const el of els) {
        try {
          this.lockClose(10)
          let attrValue = await el.getAttribute(attr)

          if (!attrValue || attrValue.startsWith('data:') || (virtualPath && attrValue.startsWith(virtualPath))) {
            continue
          }

          // fix: correct src (amp version gluck)
          if (
            !['twitter', 'facebook', 'google', 'share'].some((x) => attrValue!.indexOf(x) === -1) &&
            attrValue.split('https://').length === 3
          ) {
            attrValue = `https://${attrValue.split('https://').slice(-1)[0]}`

            await el.evaluate((elem, { attr, attrValue }) => elem.setAttribute(attr, attrValue), {
              attr,
              attrValue
            })
          }

          this.lockClose(10)
          if (attrValue.startsWith(donorUrl.host)) {
            await el.evaluate((elem, { attr, attrValue }) => elem.setAttribute(attr, attrValue), {
              attr,
              attrValue: attrValue.replace(donorUrl.host, `{ACCEPTOR_HOST}/${virtualPath}`)
            })
            continue
          }

          this.lockClose(10)
          if (attrValue.startsWith('//')) {
            if (attrValue.indexOf(donorDomain) === -1) {
              continue
            }
            await el.evaluate((elem, { attr, attrValue }) => elem.setAttribute(attr, attrValue), {
              attr,
              attrValue: `//${virtualPath}${attrValue.replace('//', '/')}`
            })
            continue
          }

          this.lockClose(10)
          if (attrValue.startsWith('http')) {
            if (attrValue.indexOf(donorDomain) === -1) {
              continue
            }
            const url = new URL(attrValue)
            const right = url.href.replace(url.origin, '')
            await el.evaluate((elem, { attr, attrValue }) => elem.setAttribute(attr, attrValue), {
              attr,
              attrValue: `{ACCEPTOR_DOMAIN}${virtualPath}${right}`
            })
            continue
          }

          this.lockClose(10)
          if (attrValue?.startsWith('/')) {
            await el.evaluate((elem, { attr, attrValue }) => elem.setAttribute(attr, attrValue), {
              attr,
              attrValue: `${virtualPath}${attrValue}`
            })
            continue
          }
        } catch {}
      }
    } catch {}

    this.lockClose()
  }

  private async rewriteElement(el: ElementHandle<SVGElement | HTMLElement>, coefWtn: number) {
    try {
      const innerText = await el.innerText()

      if (!(await this.canBeRewrite(el, innerText))) {
        return
      }

      this.lockClose(6e5)
      const rewritedResult = await this.getRewritedResult(innerText, coefWtn)

      if (rewritedResult.err || !rewritedResult.text?.length || innerText === rewritedResult.text) {
        return
      }

      await el.evaluate(
        (e, { rewriteVal }) => {
          e.innerHTML = rewriteVal
        },
        { rewriteVal: rewritedResult.text }
      )
    } catch {}
  }

  // async removeHtml(page: Page, cleanOpts?: TCleanOpts, removers?: TRemovers) {
  //   if (cleanOpts?.disableCleanHtml || !removers?.html) {
  //     return
  //   }
  //   this.lockClose(60)

  //   const selectors = removers.html.filter((x: any) => x.inner?.regex)
  //   for (const sel of selectors) {
  //     try {
  //       const els = await page.$$(sel.inner!.text)
  //       for (const el of els.slice(0, sel.inner?.count || els.length)) {
  //         try {
  //           this.lockClose(10)
  //           await el.evaluate((e) => e.remove())
  //         } catch (e) {
  //           console.log(e)
  //         }
  //       }
  //     } catch (e) {
  //       console.log(e)
  //     }
  //   }

  //   this.lockClose()
  // }

  // async removeScripts(
  //   page: Page,
  //   cleanOpts?: TCleanOpts,
  //   removers?: TRemovers,
  //   url?: string
  // ) {
  //   if (cleanOpts?.disableCleanHtml || !removers?.scripts) {
  //     return
  //   }

  //   this.lockClose(60)
  //   const elsScripts = await page.$$('script')
  //   for (const script of elsScripts) {
  //     try {
  //       this.lockClose(10)
  //       const text = (await script.textContent()) || ''

  //       const needRemove = removers?.scripts.some(
  //         (rs: TRemoverEl) => rs.inner?.text && text.includes(rs.inner.text)
  //       )

  //       needRemove && (await script.evaluate((e) => e.remove()))
  //     } catch (e: any) {
  //       console.log(e)
  //     }
  //   }

  //   const elsNoScripts = await page.$$('noscript')
  //   for (const e of elsNoScripts) {
  //     try {
  //       this.lockClose(10)
  //       const innerHtml = (await e.innerHTML()) || ''

  //       if (!innerHtml) {
  //         continue
  //       }

  //       const needRemove = removers?.scripts.some(
  //         (rs: TRemoverEl) =>
  //           rs.inner?.text && innerHtml.includes(rs.inner.text)
  //       )

  //       needRemove && (await e.evaluate((e) => e.remove()))
  //     } catch (e) {
  //       console.log(e)
  //     }
  //   }

  //   const elsIframes = await page.$$('iframe')
  //   for (const e of elsIframes) {
  //     try {
  //       this.lockClose(10)
  //       const src = (await e.getAttribute('src')) || ''

  //       if (!src) {
  //         continue
  //       }

  //       const needRemove = removers?.scripts.some(
  //         (rs: TRemoverEl) =>
  //           rs.inner?.text &&
  //           new RegExp(rs.inner.text, rs.inner.flags).test(src)
  //       )

  //       needRemove && (await e.evaluate((e) => e.remove()))
  //     } catch (e) {
  //       console.log(e)
  //     }
  //   }

  //   this.lockClose()
  // }

  async extractPageInfo(
    page: Page,
    url: string,
    nReadOpts?: TNreadOpts,
    donorDomain?: string,
    acceptorDomain?: string
  ) {
    this.lockClose(60)
    let content = (await page.content()) || ''
    let title = (await page.title()) || ''
    let h1 = (await (await page.$('h1'))?.innerText()) || title
    let descr = (await (await page.$("meta[name='description']"))?.getAttribute('content')) || ''
    let pageImg = (await (await page.$("meta[property='og:image']"))?.getAttribute('content')) || ''

    try {
      const u = new URL(url)
      const disalowPaths = ['/category/', '/page/']
      const linkLevel = u.pathname.split('/').filter((x) => x).length

      const hasDisalow = disalowPaths.some((d) => u.pathname.includes(d))
      const includePath = nReadOpts?.include?.some((includePath) => new RegExp(includePath).test(url))
      const isMinLinkLevel = linkLevel >= (nReadOpts?.minLinkLevel || 0)
      const needNRead = includePath && isMinLinkLevel && !hasDisalow

      if (needNRead) {
        try {
          this.lockClose(30)

          const html = await page.content()

          // TODO: use cheerio
          // const doc1 = cheerio.document ???
          // const reader = new Readability(doc1)

          const doc = new JSDOM(html)
          const reader = new Readability(doc.window.document)
          const article = reader.parse()

          if (article?.title) {
            title = article.title
          }
          if (!descr && article?.excerpt) {
            descr = article.excerpt
          }

          if (article?.content) {
            content = new TemplateDarkBootstrap({
              title,
              h1,
              //lang: locale,
              description: descr,
              keyValues: {
                backgroundUrl: pageImg,
                subheading: descr,
                searchplaceholder: 'Search...'
              }
            }).getFullPage({
              pageType: 'article',
              articleContent: article.content
            })

            try {
              this.lockClose(30)
              const nreadPage = await this.browserContext!.newPage()
              await nreadPage.setContent(content, {})
              await this.applyImages(nreadPage, donorDomain, acceptorDomain)

              content = await nreadPage.content()
              await nreadPage.close()
            } catch (e: any) {
              logTg(e)
            }
          }
        } catch {}
      }
    } catch (e) {
      // console.log(e)
    }

    this.lockClose()
    return { title, descr, h1, content, pageImg }
  }
}

export async function scrollToBottom(page: Page) {
  await page.evaluate(() => {
    const divs = document.querySelectorAll('div')

    divs &&
      divs.length &&
      divs[divs.length - 1] &&
      divs[divs.length - 1].scrollIntoView &&
      divs[divs.length - 1].scrollIntoView({
        behavior: 'smooth',
        block: 'end',
        inline: 'end'
      })
  })
}

// export async function autoScroll(page: Page) {
//   await page.evaluate(async () => {
//     return await new Promise((resolve, reject) => {
//       var totalHeight = 0
//       var distance = 100
//       var timer = setInterval(() => {
//         var scrollHeight = Math.max(
//           document.body.scrollHeight,
//           window.innerHeight
//         )
//         window.scrollBy(0, distance)
//         totalHeight += distance

//         if (totalHeight >= scrollHeight) {
//           clearInterval(timer)
//           resolve(null)
//         }
//       }, 100)
//     })
//   })
// }

// const obj = {
//   func: urFunc.toString(),
// }
// const otherObj = {
//   foo: 'bar',
// }

// const doc = await page.evaluate(
//   ({ obj, otherObj }) => {
//     const funStr = obj.func
//     const func = new Function(`return ${funStr}.apply(null, arguments)`)
//     func(document)

//     const foo = otherObj.foo // bar, for object
//     // window.foo = foo
//     debugger

//     return document
//   },
//   {
//     obj,
//     otherObj,
//   }
// )

// TODO: PNG/JPEG/PDF
// if (
//   contentType === mimeTypes.html &&
//   donor.parserOpts?.mode === 'pwrt'
// ) {
//   const { page } = await PwrtSvc.get({
//     url: donorFullUrl,
//     waitUntil: 'networkidle',
//   })
//   await sleep(10e3)

//   const bufferPng = await page.screenshot({
//     fullPage: true,
//     type: 'png',
//   })
//   res.setHeader('content-type', `${mimeTypes.png}; charset=utf-8`)

//   // await page.emulateMedia({ media: 'screen' })
//   // const bufferPdf = await page.pdf({})
//   // res.setHeader('content-type', `${mimeTypes.pdf}; charset=utf-8`)
//   await page.close()

//   // return res.send(bufferPdf)
//   return res.send(bufferPng)
// }

export * from './managers/cleaning'
export * from './managers/extractors'
export * from 'browser-manager'
export * from 'browser-manager/lib/types'
