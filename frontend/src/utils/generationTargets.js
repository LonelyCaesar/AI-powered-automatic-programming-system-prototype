const CREATE_VERB_PATTERN = /(?:建立|新增|產生|生成|製作|開發|create|build|generate|develop)/i
const MULTI_FILE_OUTPUT_PATTERN = /(?:各自|分別|每(?:一|個|種).*?(?:檔案|文件)|一(?:種|個).*?一(?:個|份).*?(?:檔案|文件)|不可.*?同一.*?(?:檔案|文件)|不能.*?同一.*?(?:檔案|文件)|separate files?|one file (?:for|per)|each.*?file)/i

function cleanNumberedItem(value = '') {
  let item = String(value || '').trim().replace(/^[，,、；;。\s]+|[，,、；;\s]+$/g, '')
  const layoutNote = item.search(/[。.!?！？]\s*(?=(?:每個|每一|各自|分別|一種一個|產出結果|建立好的|多個|多建立|不可|不能|請將|請把))/)
  if (layoutNote >= 0) item = item.slice(0, layoutNote).trim()
  return item.replace(/[。.!?！？]+$/g, '').trim()
}

export function extractNumberedGenerationItems(instruction = '') {
  const text = String(instruction || '')
  const markerPattern = /(?:^|[\n\r，,、；;。])\s*(\d{1,2})\s*[.．、)）:：]\s*/g
  const markers = [...text.matchAll(markerPattern)]
  if (markers.length < 2) return []

  const numbers = markers.map(match => Number(match[1]))
  const isOrdered = numbers.every((number, index) => index === 0 || number === numbers[index - 1] + 1)
  if (!isOrdered) return []

  return markers
    .map((match, index) => {
      const start = match.index + match[0].length
      const end = index + 1 < markers.length ? markers[index + 1].index : text.length
      return cleanNumberedItem(text.slice(start, end))
    })
    .filter(Boolean)
}

export function getMultiFileGenerationItems(instruction = '') {
  const text = String(instruction || '')
  const items = extractNumberedGenerationItems(text)
  if (items.length < 2) return []

  const createItemCount = items.filter(item => CREATE_VERB_PATTERN.test(item)).length
  const explicitlySeparate = MULTI_FILE_OUTPUT_PATTERN.test(text)
  if (createItemCount < 2 && !explicitlySeparate) return []

  return items
}

export function buildMultiFileGenerationInstruction(instruction = '', items = []) {
  const cleanInstruction = String(instruction || '').trim()
  const cleanItems = (items || []).map(cleanNumberedItem).filter(Boolean)
  if (cleanItems.length < 2) return cleanInstruction

  return `${cleanInstruction}

【同一資料夾多檔輸出規則（必須遵守）】
需求包含 ${cleanItems.length} 個程式：
${cleanItems.map((item, index) => `${index + 1}. ${item}`).join('\n')}

- 在目前已開啟的同一個資料夾內，為每個程式各建立一個獨立程式碼檔案。
- 必須剛好建立 ${cleanItems.length} 個同層檔案，不可建立子資料夾。
- 不可把多個程式合併到任何單一共用檔案。
- 每個檔案必須是可直接執行的完整程式，使用能表達用途的安全英文小寫檔名。`
}
