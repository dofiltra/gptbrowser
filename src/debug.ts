import { extractPageDate } from '.'
import fetch from 'node-fetch'
;(async () => {
  const resp1 = await fetch(
    'https://noalkogolizm.ru/news/news/2021/11/07/massovo-zaboleli-grippom-igroki-hokkeynogo-kluba-salavat-yulaev.html'
  )
  const resp2 = await fetch('https://hotnewstoday24.ru/news-today/mezhdunarodnaya-panorama/12855281')

  const html1 = await resp1.text()
  const html2 = await resp2.text()

  await extractPageDate(html1)
  await extractPageDate(html2)
})()
