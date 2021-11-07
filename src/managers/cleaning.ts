/* tslint:disable:prefer-const */
/* tslint:disable:no-empty */
/* tslint:disable:no-shadowed-variable */
/* tslint:disable:only-arrow-functions */
/* tslint:disable:forin */
/* tslint:disable:no-unused-expression */
/* tslint:disable:prefer-for-of */
/* tslint:disable:comment-format */
/* tslint:disable:no-unused-expression */

import { CheerManager } from 'cheer-manager'
import { TDeeplSettings } from 'deepler'
import {
  TCustoms,
  TCleanOpts,
  TReplacers,
  TRemovers,
  TRemoverEl,
  TDomainData,
  TAds,
  TAcceptorInfo,
  TRewriteOpts
} from 'dprx-types'
import { reTryCatch } from 'esm-requirer'
import _ from 'lodash'
import { mimeTypes } from 'mime-helper'
import { TWtnSettings } from 'wtn-svc'
import { GptBrowser, TBrowserOpts } from '..'

export type TCleanSettings = {
  text: string
  url: string
  contentType: string
  domainData: TDomainData
  acceptor: TAcceptorInfo
  browserOpts: TBrowserOpts
  wtnSettings?: TWtnSettings
  deeplSettings?: TDeeplSettings
  isFlasher?: boolean
  noBrowser?: boolean
  rewriteOpts?: TRewriteOpts
  needPageDate?: boolean
}

export class CleaningSvc {
  async getClean({
    text,
    url,
    contentType,
    acceptor,
    domainData,
    isFlasher,
    noBrowser,
    rewriteOpts,
    browserOpts,
    deeplSettings,
    wtnSettings,
    needPageDate
  }: TCleanSettings): Promise<{ content?: string; pageDate?: Date }> {
    return (
      await reTryCatch({
        title: 'getClean',
        fn: async () => {
          const isHtml = contentType === mimeTypes.html

          const donor =
            domainData.donors?.find((x) => x.virtualPath && url.includes(x.virtualPath)) ||
            domainData.donors?.find((x) => url.includes(x.domain))

          const virtualPath = donor?.virtualPath || ''

          let content = getContentWithVirtualPath(text, virtualPath)
          let pageDate = null

          if (isHtml) {
            const opts = {
              text: content,
              url,
              acceptor,
              isFlasher,
              rewriteOpts,
              browserOpts,
              deeplSettings,
              wtnSettings,
              contentType,
              domainData
            }
            const { content: cleanContent } = noBrowser
              ? await this.getNoBrowserContent(opts)
              : await this.getBrowserContent(opts)

            if (cleanContent) {
              content = cleanContent
            }
          }

          if (!isHtml || noBrowser) {
            ;(domainData.donors?.map((d) => new URL(d.domain)) || []).forEach((donorInfo: URL) => {
              content = content
                .replace(new RegExp(donorInfo.host.toLowerCase(), 'gi'), acceptor.host + virtualPath)
                .replace(new RegExp(donorInfo.protocol, 'gi'), acceptor.protocol)
            })
          }

          content = content?.replaceAll('{ACCEPTOR_HOST}', `${acceptor.host}`)
          content = content?.replaceAll('{ACCEPTOR_DOMAIN}', `${acceptor.domain}`)

          if (isHtml) {
            content = await advertise(content, domainData)
            pageDate = needPageDate && (await extractPageDate(content))
          }

          return { content, pageDate }
        },
        defaultValue: { content: text }
      })
    ).result
  }

  private async getNoBrowserContent({ text, url, domainData }: TCleanSettings) {
    const { removers, replacers, customs } = domainData
    const donor =
      domainData.donors?.find((x) => x.virtualPath && url.includes(x.virtualPath)) ||
      domainData.donors?.find((x) => url.includes(x.domain))

    let content = (!url.includes('?amp') && (await replaceHtml(text, donor?.cleanOpts, replacers))) || text
    content = await removeTags(content, donor?.cleanOpts, removers)
    content = await replaceCustoms(content, customs)

    return { content }
  }

  private async getBrowserContent({
    text,
    url,
    acceptor,
    domainData,
    isFlasher,
    rewriteOpts,
    browserOpts,
    deeplSettings,
    wtnSettings
  }: TCleanSettings) {
    const pwrt = await GptBrowser.build<GptBrowser>(browserOpts, {
      deeplSettings,
      wtnSettings
    })
    try {
      const { removers, replacers, customs } = domainData
      const donor =
        domainData.donors?.find((x) => x.virtualPath && url.includes(x.virtualPath)) ||
        domainData.donors?.find((x) => url.includes(x.domain))

      return await pwrt!.getContent({
        donor,
        acceptor,
        url,
        html: text,
        replacers,
        removers,
        customs,
        isFlasher,
        rewriteOpts
      })
    } catch (e: any) {
    } finally {
      await pwrt?.close()
    }

    return { content: text } as any
  }
}

export async function replaceCustoms(content?: string, customs?: TCustoms) {
  if (!content?.length || !customs) {
    return content || ''
  }

  const { sections } = customs
  const { gtagCode, googleSiteVerification, code: headCode } = { ...sections?.head }
  const { code: footerCode } = { ...sections?.footer }

  if (googleSiteVerification) {
    content = content.replace(
      '</head>',
      `<meta name="google-site-verification" content="${googleSiteVerification}" />
        </head>`
    )
  }

  if (gtagCode) {
    content = content.replace(
      '</head>',
      `<script async src="https://www.googletagmanager.com/gtag/js?id=${gtagCode}"></script>
         <script>window.dataLayer = window.dataLayer || [];function gtag(){dataLayer.push(arguments);}gtag('js', new Date());gtag('config', '${gtagCode}');</script>
      </head>`
    )
  }

  if (headCode) {
    content = content.replace('</head>', `${headCode}</head>`)
  }

  if (footerCode) {
    content = content.replace('</body>', `${footerCode}</body>`)
  }

  return content
}

export async function replaceHtml(html?: string, cleanOpts?: TCleanOpts, replacers?: TReplacers) {
  if (cleanOpts?.disableReplaceHtml || !replacers?.html || !html) {
    return html || ''
  }

  try {
    const replaceElements = replacers?.html
    const textEls = replaceElements?.filter((r: any) => r.textValue) || []
    const regexEls = replaceElements?.filter((r: any) => r.regex) || []

    for (const re of textEls) {
      html = html.replaceAll(re.textValue!, re.newValue)
    }

    for (const re of regexEls) {
      html = html.replaceAll(new RegExp(re.regex!, re.flags), re.newValue)
    }
  } catch (e: any) {
    // logTg(`replaceHtml: ${e}`)
  }

  return html
}

export async function removeTags(htmlText: string, cleanOpts?: TCleanOpts, removers?: TRemovers) {
  if (!htmlText || cleanOpts?.disableCleanHtml === true) {
    return htmlText
  }

  const { html = [], scripts = [] } = { ...removers }
  const cheer = new CheerManager({ html: htmlText })

  function rmElem(rmEl: TRemoverEl) {
    try {
      const { count: innerCount = Number.MAX_SAFE_INTEGER, text: innerText } = {
        ...rmEl.inner
      }

      const { count: selectorCount = Number.MAX_SAFE_INTEGER, selector } = {
        ...rmEl.selectorItem
      }

      ;['script:not([src])', 'iframe', 'noscript'].map((x) => cheer.rmByInnerText(x, innerText, innerCount))

      cheer.rmBySelector(selector!, selectorCount)
    } catch {}
  }

  html.forEach((rmEl) => rmElem(rmEl))
  scripts.forEach((rmEl) => rmElem(rmEl))

  return cheer.getHtml()
}

export async function advertise(html: string, domainData: TDomainData) {
  if (!html) {
    return html
  }
  try {
    const cheer = new CheerManager({ html })
    const {
      beforeH1 = [],
      afterH1 = [],
      bubble = [],
      afterContent = [],
      everyN = [],
      afterNextPrev = []
    } = (domainData.ads || {}) as TAds

    let adsData
    let selectors

    adsData = _.shuffle(beforeH1)[0]
    adsData && cheer.$('h1').before(adsData.html)

    adsData = _.shuffle(afterH1)[0]
    adsData && cheer.$('h1').after(adsData.html)

    adsData = _.shuffle(bubble)[0]
    adsData && cheer.$('p').before(adsData.html)

    adsData = _.shuffle(afterContent)[0]
    selectors = adsData?.selectors || []
    for (const selector of selectors) {
      const node = cheer.$(selector)
      if (node) {
        node.after(adsData.html)
        break
      }
    }

    adsData = _.shuffle(afterNextPrev)[0]
    selectors = _.flatten(afterNextPrev.map((x) => x.selectors || [])).filter((s) => s)
    for (const selector of selectors) {
      const node = cheer.$(selector)
      if (node) {
        node.after(adsData.html)
        break
      }
    }

    selectors = _.flatten(everyN.map((x) => x.selectors || [])).filter((s) => s)
    selectors.push(...['article p', 'p'])
    for (const selector of selectors) {
      const node = cheer.$(selector)
      if (node) {
        node.each((index, elem) => {
          const { repeatN = 3, html: adsHtml } = _.shuffle(everyN)[0]
          if (index % repeatN === 0) {
            cheer.$(elem).after(adsHtml)
          }
        })
        break
      }
    }

    return cheer.getHtml()
  } catch {}

  return html
}

export function replacerVirtualPath(text: string, virtualPath?: string, attrs?: string[]) {
  if (!text || !virtualPath || !attrs?.length) {
    return text || ''
  }

  for (const attr of attrs) {
    try {
      text = text.replaceAll(`${attr}//`, `${attr}__temp_double_slash__`)
      text = text.replaceAll(`${attr}/`, `${attr}${virtualPath}/`)
      text = text.replaceAll(`${attr}__temp_double_slash__`, `${attr}//`)
    } catch (e: any) {
      // logTg(`replacerVirtualPath: '${attr}': ${e}`)
    }
  }

  return text
}

export function getContentWithVirtualPath(text: string, virtualPath: string) {
  return replacerVirtualPath(text, virtualPath, [
    'url(',
    'url("',

    'action="',
    "action='",

    'href="',
    "href='",

    'src="',
    "src='"
  ])
}

export async function extractPageDate(html: string) {
  if (!html) {
    return null
  }
  try {
    const cheer = new CheerManager({ html })
    const selectorsAttrContent = [
      "meta[itemprop='dateModified']",
      "meta[itemprop='datePublished']",
      "meta[property='article:published_time']"
    ]
    for (const selector of selectorsAttrContent) {
      try {
        const el = cheer.$(selector)
        if (!el.length) {
          continue
        }

        const content = el.attr('content')
        if (!content) {
          continue
        }

        return new Date(content!)
      } catch {}
    }

    const scriptsLd = cheer.$("script[type='application/ld+json']")
    for (const script of scriptsLd) {
      try {
        const c = script.children[0] as any
        const data = JSON.parse(c.data)
        const datePublished = data.dateModified || data.datePublished
        if (!datePublished) {
          continue
        }

        return new Date(datePublished)
      } catch {}
    }
  } catch {}

  return null
}
