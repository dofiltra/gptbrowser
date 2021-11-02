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
    logTg(`replaceHtml: ${e}`)
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
      let { count: innerCount = Number.MAX_SAFE_INTEGER, text: innerText } = {
        ...rmEl.inner
      }

      let { count: selectorCount = Number.MAX_SAFE_INTEGER, selector } = {
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

export const replacerVirtualPath = (text: string, virtualPath: string, attrs: string[]) => {
  if (!text || !virtualPath || !attrs?.length) {
    return text || ''
  }

  for (const attr of attrs) {
    try {
      text = text.replaceAll(`${attr}//`, `${attr}__temp_double_slash__`)
      text = text.replaceAll(`${attr}/`, `${attr}${virtualPath}/`)
      text = text.replaceAll(`${attr}__temp_double_slash__`, `${attr}//`)
    } catch (e: any) {
      logTg(`replacerVirtualPath: '${attr}': ${e}`)
    }
  }

  return text
}
