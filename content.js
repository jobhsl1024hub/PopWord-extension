let words = [];
let currentWordData = null;
let clickCount = 0;
let showBoth = false;
let playAudioEnabled = true;
let fadeTime = 2; // 默认2秒
let wordLibrary = 'CET4.json'; // 默认词库
let currentWordIndex = 0; // 当前单词索引，用于顺序获取单词
let audioApi = 'https://dict.youdao.com/dictvoice?type=0&audio='; // 默认音频API
let wordHistory = []; // 单词历史记录
let historyIndex = -1; // 当前历史记录索引
let nextKey = ''; // 下一个单词按键
let prevKey = ''; // 上一个单词按键
let popwordEnabled = true; // 弹词功能是否开启（功能菜单中可关闭）

// 开发时设为 true 可输出日志；关闭可减少卡顿
const DEBUG = false;
function dbg(...args) { if (DEBUG) console.log(...args); }

// 防抖：合并频繁的 storage 写入，减轻卡顿
let savePositionTimer = null;
let saveWordMemoryQueue = [];
let saveWordMemoryTimer = null;

// Fisher–Yates 洗牌，原地打乱数组顺序
function shuffle(array) {
  const arr = Array.isArray(array) ? array : [];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 加载单词库（加载后对词库随机打乱顺序）
async function loadWords() {
  try {
    // 默认使用word文件夹作为词库路径，加载当前被选择的词库（避免直接使用默认库）
    // 1️⃣ 从 storage 读取
    const result = await chrome.storage.sync.get(['wordLibrary']);
    const wordLibrary = result.wordLibrary || 'SAT.json'; // 给个默认值SAT.json

    // 2️⃣ 再去 fetch
    const response = await fetch(chrome.runtime.getURL(`word/${wordLibrary}`));
    words = await response.json();
    shuffle(words); // 随机顺序
    console.log('词库加载成功:', wordLibrary, '共', words.length, '个单词（已随机顺序）');

    // 加载历史记录；随机顺序下不从存储恢复遍历位置，从打乱后的第 0 个开始
    await loadHistory();
    currentWordIndex = 0;
  } catch (error) {
    console.error('加载单词库失败:', error);
    // 尝试加载可用的词库文件
    try {
      // 尝试加载CET4.json
      const response = await fetch(chrome.runtime.getURL('word/CET4.json'));
      words = await response.json();
      shuffle(words);
      currentWordIndex = 0;
      wordLibrary = 'CET4.json'; // 更新词库名称
      console.log('加载CET4.json成功（已随机顺序）');

      // 加载历史记录，获取上次的遍历位置
      await loadHistory();
    } catch (error2) {
      console.error('加载词库失败:', error2);
      // 如果所有词库都加载失败，使用默认单词列表
      words = [
        { "word": "hello", "translations": [{ "translation": "你好", "type": "int" }] },
        { "word": "world", "translations": [{ "translation": "世界", "type": "n" }] },
        { "word": "apple", "translations": [{ "translation": "苹果", "type": "n" }] },
        { "word": "banana", "translations": [{ "translation": "香蕉", "type": "n" }] },
        { "word": "cat", "translations": [{ "translation": "猫", "type": "n" }] }
      ];
      shuffle(words);
      currentWordIndex = 0;
      console.log('使用默认单词列表');
    }
  }
}

// 加载历史记录
async function loadHistory() {
  try {
    // 获取当前词库名称（去掉.json后缀）
    const libraryName = wordLibrary.replace('.json', '');
    const storagePositionKey = `wordPosition_${libraryName}`;
    const storageHistoryKey = `wordHistory_${libraryName}`;

    console.log('尝试加载历史记录，词库:', libraryName);

    // 从Chrome存储中获取遍历位置和历史记录
    return new Promise((resolve) => {
      chrome.storage.local.get([storagePositionKey, storageHistoryKey], function (result) {
        if (result[storagePositionKey] !== undefined) {
          currentWordIndex = result[storagePositionKey];
          console.log('从存储中加载遍历位置:', currentWordIndex);
        } else {
          console.log('没有找到历史遍历位置，从0开始');
          currentWordIndex = 0;
        }

        if (result[storageHistoryKey] !== undefined) {
          // 从存储中加载历史记录，并转换为完整的单词对象结构
          wordHistory = result[storageHistoryKey].map(record => {
            // 如果记录已经是完整的单词对象（包含translations），则直接使用
            if (record.translations) {
              return record;
            }
            // 否则，将简化记录转换为完整的单词对象结构
            return {
              word: record.word,
              translations: [{
                translation: record.meaning || '',
                type: record.type || ''
              }],
              // 保留原始日期
              date: record.date
            };
          });
          historyIndex = wordHistory.length - 1;
          console.log('从存储中加载历史记录，长度:', wordHistory.length);
        } else {
          console.log('没有找到历史记录，初始化空数组');
          wordHistory = [];
          historyIndex = -1;
        }
        resolve();
      });
    });
  } catch (error) {
    console.error('加载历史记录失败:', error);
    currentWordIndex = 0;
    wordHistory = [];
    historyIndex = -1;
    return Promise.resolve();
  }
}

// 防抖保存遍历位置（约 500ms 内多次只写一次）
function scheduleSavePosition() {
  if (savePositionTimer) clearTimeout(savePositionTimer);
  savePositionTimer = setTimeout(() => {
    savePositionTimer = null;
    savePosition();
  }, 500);
}

// 保存遍历位置和历史记录
function savePosition() {
  try {
    // 获取当前词库名称（去掉.json后缀）
    const libraryName = wordLibrary.replace('.json', '');
    const storagePositionKey = `wordPosition_${libraryName}`;
    const storageHistoryKey = `wordHistory_${libraryName}`;

    // 保存当前遍历位置和历史记录到Chrome存储
    chrome.storage.local.set({
      [storagePositionKey]: currentWordIndex,
      [storageHistoryKey]: wordHistory
    }, function () {
      console.log('遍历位置保存成功:', currentWordIndex);
      console.log('历史记录保存成功，长度:', wordHistory.length);
    });
  } catch (error) {
    console.error('保存遍历位置和历史记录失败:', error);
  }
}

// 加载设置
function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['showBoth', 'playAudio', 'fadeTime', 'wordLibrary', 'audioApi', 'nextKey', 'prevKey', 'popwordEnabled'], function (data) {
      showBoth = data.showBoth || false;
      playAudioEnabled = data.playAudio !== false; // 默认开启
      fadeTime = data.fadeTime || 2; // 默认2秒
      wordLibrary = data.wordLibrary || 'CET4.json'; // 默认词库
      audioApi = data.audioApi || 'https://dict.youdao.com/dictvoice?type=0&audio='; // 默认音频API
      nextKey = data.nextKey || '鼠标左键'; // 下一个单词按键，默认鼠标左键
      prevKey = data.prevKey || '鼠标右键'; // 上一个单词按键，默认鼠标右键
      popwordEnabled = data.popwordEnabled !== false; // 默认开启弹词
      resolve();
    });
  });
}

// 顺序获取一个单词
function getRandomWord() {
  if (words.length === 0) return null;
  const word = words[currentWordIndex];
  console.log('获取单词:', word.word, '当前索引:', currentWordIndex);
  // 递增索引，循环使用
  currentWordIndex = (currentWordIndex + 1) % words.length;
  console.log('下一个索引:', currentWordIndex);
  // 保存单词记忆记录（防抖，避免每次点击都写 storage）
  saveWordMemory(word);
  // 保存遍历位置（防抖）
  scheduleSavePosition();
  return word;
}

// 保存单词记忆记录
function saveWordMemory(wordData) {
  if (!wordData || !wordData.word) {
    console.log('单词数据为空，无法保存记忆记录');
    return;
  }

  try {
    // 获取当前词库名称（去掉.json后缀）
    const libraryName = wordLibrary.replace('.json', '');

    // 从translations中获取中文意思和词性
    const meaning = wordData.translations && wordData.translations.length > 0 ? wordData.translations[0].translation : '';
    const type = wordData.translations && wordData.translations.length > 0 ? wordData.translations[0].type : '';

    // 创建记忆记录
    const memoryRecord = {
      word: wordData.word,
      type: type,
      meaning: meaning,
      date: new Date().toISOString()
    };

    console.log('准备保存记忆记录:', memoryRecord);

    // 入队后防抖批量写入，减少 storage 写入次数
    saveWordMemoryQueue.push({ storageKey: `wordHistory_${libraryName}`, record: memoryRecord });
    if (saveWordMemoryTimer) clearTimeout(saveWordMemoryTimer);
    saveWordMemoryTimer = setTimeout(flushWordMemoryQueue, 800);
  } catch (error) {
    console.error('保存单词记忆记录时发生错误:', error);
  }
}

// 防抖批量写入记忆记录，减少卡顿
function flushWordMemoryQueue() {
  saveWordMemoryTimer = null;
  if (saveWordMemoryQueue.length === 0) return;
  const byKey = new Map();
  for (const { storageKey, record } of saveWordMemoryQueue) {
    if (!byKey.has(storageKey)) byKey.set(storageKey, []);
    byKey.get(storageKey).push(record);
  }
  saveWordMemoryQueue = [];
  chrome.storage.local.get(Array.from(byKey.keys()), (result) => {
    const toSet = {};
    for (const [storageKey, records] of byKey) {
      const history = (result[storageKey] || []).concat(records);
      toSet[storageKey] = history.length > 1000 ? history.slice(-1000) : history;
    }
    chrome.storage.local.set(toSet, () => { dbg('单词记忆记录批量保存成功'); });
  });
}

// 页面卸载前务必落盘，避免丢失进度
window.addEventListener('beforeunload', () => {
  if (savePositionTimer) { clearTimeout(savePositionTimer); savePosition(); }
  flushWordMemoryQueue();
});

// 显示单词或中文意思
function showWordEffect(x, y, direction = 'next') {
  console.log('点击事件触发，playAudioEnabled:', playAudioEnabled, 'showBoth:', showBoth, 'direction:', direction);
  console.log('点击位置:', x, y);
  console.log('单词库大小:', words.length);
  console.log('当前历史记录索引:', historyIndex);
  console.log('历史记录长度:', wordHistory.length);
  // 移除旧的元素
  const oldElements = document.querySelectorAll('.word-effect');
  console.log('移除旧元素数量:', oldElements.length);
  oldElements.forEach(el => el.remove());

  if (showBoth) {
    // 如果设置为同时显示单词和中文意思
    if (direction === 'prev') {
      // 右键点击，显示上一个单词
      if (historyIndex > 0) {
        historyIndex--;
        currentWordData = wordHistory[historyIndex];
        console.log('获取上一个单词:', currentWordData.word);
        // 播放音频（如果开启）
        if (playAudioEnabled) {
          console.log('准备播放音频');
          playAudio(null, currentWordData.word);
        } else {
          console.log('音频播放已禁用');
        }
        // 处理不同结构的单词数据
        let meaning, type;
        if (currentWordData.translations && currentWordData.translations.length > 0) {
          // 完整的单词对象，从translations中获取
          meaning = currentWordData.translations[0].translation;
          type = currentWordData.translations[0].type;
        } else {
          // 简化的记录，直接使用type和meaning属性
          meaning = currentWordData.meaning || '';
          type = currentWordData.type || '';
        }
        const wordWithType = type ? `${currentWordData.word} (${type})` : currentWordData.word;
        const text = `${wordWithType}\n${meaning}`;
        console.log('创建浮动元素，文本:', text);
        createFloatingElement(text, x, y, 'word-with-meaning');
      } else {
        console.log('已经是第一个单词');
      }
    } else {
      // 左键点击，显示下一个单词
      if (historyIndex < wordHistory.length - 1) {
        // 如果不是在历史记录的末尾，显示历史记录中的下一个单词
        historyIndex++;
        currentWordData = wordHistory[historyIndex];
        console.log('获取历史记录中的下一个单词:', currentWordData.word);
      } else {
        // 如果在历史记录的末尾，生成新单词
        currentWordData = getRandomWord();
        if (currentWordData) {
          console.log('获取到新单词:', currentWordData.word);
          // 添加到历史记录
          wordHistory.push(currentWordData);
          historyIndex++;
          // 限制历史记录长度，避免内存占用过大
          if (wordHistory.length > 100) {
            wordHistory.shift();
            historyIndex--;
          }
          // 保存单词记忆记录
          saveWordMemory(currentWordData);
        }
      }

      if (currentWordData) {
        // 播放音频（如果开启）
        if (playAudioEnabled) {
          console.log('准备播放音频');
          playAudio(null, currentWordData.word);
        } else {
          console.log('音频播放已禁用');
        }
        // 处理不同结构的单词数据
        let meaning, type;
        if (currentWordData.translations && currentWordData.translations.length > 0) {
          // 完整的单词对象，从translations中获取
          meaning = currentWordData.translations[0].translation;
          type = currentWordData.translations[0].type;
        } else {
          // 简化的记录，直接使用type和meaning属性
          meaning = currentWordData.meaning || '';
          type = currentWordData.type || '';
        }
        const wordWithType = type ? `${currentWordData.word} (${type})` : currentWordData.word;
        const text = `${wordWithType}\n${meaning}`;
        console.log('创建浮动元素，文本:', text);
        createFloatingElement(text, x, y, 'word-with-meaning');
      } else {
        console.log('未获取到单词数据');
      }
    }
  } else {
    // 如果设置为分开显示单词和中文意思
    clickCount++;
    console.log('当前点击次数:', clickCount);

    if (direction === 'prev') {
      // 右键点击，显示上一个单词
      if (historyIndex > 0) {
        historyIndex--;
        currentWordData = wordHistory[historyIndex];
        console.log('获取上一个单词:', currentWordData.word);

        if (clickCount % 2 === 1) {
          // 右键第一下，显示上一个英文
          // 播放音频（如果开启）
          if (playAudioEnabled) {
            console.log('准备播放音频');
            playAudio(null, currentWordData.word);
          } else {
            console.log('音频播放已禁用');
          }
          // 处理不同结构的单词数据
          let type;
          if (currentWordData.translations && currentWordData.translations.length > 0) {
            // 完整的单词对象，从translations中获取
            type = currentWordData.translations[0].type;
          } else {
            // 简化的记录，直接使用type属性
            type = currentWordData.type || '';
          }
          const wordWithType = type ? `${currentWordData.word} (${type})` : currentWordData.word;
          console.log('创建浮动元素，文本:', wordWithType);
          createFloatingElement(wordWithType, x, y, 'word');
        } else {
          // 右键第二下，显示上一个的中文
          // 处理不同结构的单词数据
          let meaning;
          if (currentWordData.translations && currentWordData.translations.length > 0) {
            // 完整的单词对象，从translations中获取
            meaning = currentWordData.translations[0].translation;
          } else {
            // 简化的记录，直接使用meaning属性
            meaning = currentWordData.meaning || '';
          }
          console.log('显示中文意思:', meaning);
          console.log('创建浮动元素，文本:', meaning);
          createFloatingElement(meaning, x, y, 'meaning');
        }
      } else {
        console.log('已经是第一个单词');
      }
    } else {
      // 左键点击
      if (clickCount % 2 === 1) {
        // 左键第一下，显示英文
        if (historyIndex < wordHistory.length - 1) {
          // 如果不是在历史记录的末尾，显示历史记录中的下一个单词
          historyIndex++;
          currentWordData = wordHistory[historyIndex];
          console.log('获取历史记录中的下一个单词:', currentWordData.word);
        } else {
          // 如果在历史记录的末尾，生成新单词
          currentWordData = getRandomWord();
          if (currentWordData) {
            console.log('获取到新单词:', currentWordData.word);
            // 添加到历史记录
            wordHistory.push(currentWordData);
            historyIndex++;
            // 限制历史记录长度，避免内存占用过大
            if (wordHistory.length > 100) {
              wordHistory.shift();
              historyIndex--;
            }
            // 保存单词记忆记录
            saveWordMemory(currentWordData);
          }
        }

        if (currentWordData) {
          // 播放音频（如果开启）
          if (playAudioEnabled) {
            console.log('准备播放音频');
            playAudio(null, currentWordData.word);
          } else {
            console.log('音频播放已禁用');
          }
          // 处理不同结构的单词数据
          let type;
          if (currentWordData.translations && currentWordData.translations.length > 0) {
            // 完整的单词对象，从translations中获取
            type = currentWordData.translations[0].type;
          } else {
            // 简化的记录，直接使用type属性
            type = currentWordData.type || '';
          }
          const wordWithType = type ? `${currentWordData.word} (${type})` : currentWordData.word;
          console.log('创建浮动元素，文本:', wordWithType);
          createFloatingElement(wordWithType, x, y, 'word');
        } else {
          console.log('未获取到单词数据');
        }
      } else {
        // 左键第二下，显示中文
        if (currentWordData) {
          // 处理不同结构的单词数据
          let meaning;
          if (currentWordData.translations && currentWordData.translations.length > 0) {
            // 完整的单词对象，从translations中获取
            meaning = currentWordData.translations[0].translation;
          } else {
            // 简化的记录，直接使用meaning属性
            meaning = currentWordData.meaning || '';
          }
          console.log('显示中文意思:', meaning);
          console.log('创建浮动元素，文本:', meaning);
          createFloatingElement(meaning, x, y, 'meaning');
        } else {
          console.log('当前没有单词数据');
        }
      }
    }
  }
}

// 创建浮动元素
function createFloatingElement(text, x, y, type) {
  console.log('开始创建浮动元素');
  console.log('文本:', text);
  console.log('位置:', x, y);
  console.log('类型:', type);

  const element = document.createElement('div');
  element.className = 'word-effect';
  element.textContent = text;
  element.style.left = `${x}px`;
  element.style.top = `${y}px`;
  element.classList.add(type);

  // 确保元素显示在最上层，使用!important覆盖所有样式
  element.style.zIndex = '999999 !important';
  element.style.position = 'fixed !important';
  element.style.pointerEvents = 'none !important';
  element.style.fontSize = '16px !important';
  element.style.fontWeight = 'bold !important';
  element.style.color = '#333 !important';
  element.style.backgroundColor = 'rgba(255, 255, 255, 0.9) !important';
  element.style.padding = '8px 12px !important';
  element.style.borderRadius = '4px !important';
  element.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1) !important';
  element.style.opacity = '1 !important'; // 确保初始状态是可见的
  element.style.transform = 'translateY(0) !important'; // 确保初始位置正确
  element.style.fontFamily = 'Arial, sans-serif !important';
  element.style.whiteSpace = 'pre-line !important';
  element.style.textAlign = 'center !important';
  element.style.margin = '0 !important';
  element.style.border = 'none !important';
  element.style.outline = 'none !important';
  element.style.textDecoration = 'none !important';
  element.style.overflow = 'visible !important';
  element.style.display = 'block !important';
  element.style.width = 'auto !important';
  element.style.height = 'auto !important';

  // 动态设置过渡动画时间，与fadeTime相匹配
  const transitionTime = (fadeTime - 0.2).toFixed(1); // 留出0.2秒的启动延迟
  element.style.transition = `opacity ${transitionTime}s ease, transform ${transitionTime}s ease !important`;

  console.log('元素创建完成，准备添加到DOM');
  console.log('元素样式:', element.style.cssText);

  try {
    document.body.appendChild(element);
    console.log('元素已添加到DOM');
    console.log('DOM中.word-effect元素数量:', document.querySelectorAll('.word-effect').length);

    // 强制重排，确保元素立即显示
    element.offsetHeight;
    console.log('元素重排完成');
  } catch (error) {
    console.error('添加元素到DOM失败:', error);
  }

  // 添加动画效果
  setTimeout(() => {
    console.log('开始动画效果');
    try {
      element.style.opacity = '0 !important';
      element.style.transform = 'translateY(-100px) !important';
    } catch (error) {
      console.error('设置动画效果失败:', error);
    }
  }, 100);

  // 动画结束后移除元素
  setTimeout(() => {
    console.log('移除元素');
    try {
      element.remove();
      console.log('元素已移除，DOM中.word-effect元素数量:', document.querySelectorAll('.word-effect').length);
    } catch (error) {
      console.error('移除元素失败:', error);
    }
  }, fadeTime * 1000);
}

// 音频缓存配置
const CACHE_SIZE = 15; // 最大缓存数量
const CACHE_THRESHOLD = 5; // 触发缓存的阈值
const INITIAL_CACHE_COUNT = 10; // 初始缓存数量
const audioCache = new Map();
let cachedWordIndices = new Set(); // 已缓存的单词索引
let usedWordCount = 0; // 已使用的单词数量
let usedWords = []; // 已使用的单词

// 播放音频
function playAudio(audioUrl, word) {
  console.log('尝试播放音频:', audioUrl, '单词:', word);
  console.log('当前audioApi:', audioApi);

  // 如果提供了完整的音频URL，直接使用
  if (audioUrl) {
    console.log('使用提供的音频URL:', audioUrl);
    playAudioWithYoudao(audioUrl, word);
  } else if (word) {
    // 使用用户指定的音频API构建URL
    const constructedUrl = audioApi + encodeURIComponent(word);
    console.log('构建的音频URL:', constructedUrl);
    playAudioWithYoudao(constructedUrl, word);
  } else {
    console.error('播放音频失败：单词为空');
  }
}

// 使用用户指定的音频API播放音频
function playAudioWithYoudao(audioUrl, word) {
  console.log('尝试播放音频:', audioUrl, '单词:', word);

  // 检查缓存中是否已有音频
  const cacheKey = `audio_${word}`;
  if (audioCache.has(cacheKey)) {
    const audio = audioCache.get(cacheKey);
    audio.currentTime = 0;
    audio.play().then(() => {
      console.log('音频播放成功（缓存）');
      // 增加使用计数
      usedWordCount++;
      // 记录已使用的单词
      usedWords.push(word);
      // 检查是否需要缓存更多音频
      checkAndCacheMoreAudio();
    }).catch(error => {
      console.error('播放音频失败（缓存）:', error);
      // 缓存失败时尝试重新加载
      loadAndPlayYoudaoAudio(audioUrl, word);
    });
  } else {
    // 首次加载音频
    loadAndPlayYoudaoAudio(audioUrl, word);
  }
}

// 加载并播放音频
function loadAndPlayYoudaoAudio(audioUrl, word) {
  console.log('加载并播放音频:', audioUrl, '单词:', word);
  try {
    // 验证音频URL
    if (!audioUrl) {
      console.error('音频URL为空');
      return;
    }

    const audio = new Audio(audioUrl);
    audio.preload = 'auto';
    audio.volume = 1.0;

    // 添加到缓存
    const cacheKey = `audio_${word}`;
    audioCache.set(cacheKey, audio);

    // 尝试播放音频
    audio.play().then(() => {
      console.log('音频播放成功:', word);
      // 增加使用计数
      usedWordCount++;
      // 记录已使用的单词
      usedWords.push(word);
      // 检查是否需要缓存更多音频
      checkAndCacheMoreAudio();
    }).catch(error => {
      console.error('音频播放失败:', error);
      // 失败时尝试使用浏览器内置的Web Speech API
      if ('speechSynthesis' in window) {
        try {
          const speech = new SpeechSynthesisUtterance(word);
          speech.lang = 'en-US';
          speech.rate = 1.0;
          speech.pitch = 1.0;
          speech.volume = 1.0;

          // 播放TTS
          window.speechSynthesis.speak(speech);
          console.log('Web Speech API播放成功:', word);

          // 增加使用计数
          usedWordCount++;
          // 记录已使用的单词
          usedWords.push(word);
          // 检查是否需要缓存更多音频
          checkAndCacheMoreAudio();
        } catch (error) {
          console.error('Web Speech API播放失败:', error);
        }
      } else {
        console.log('浏览器不支持Web Speech API');
      }
    });
  } catch (error) {
    console.error('加载音频失败:', error);
    // 尝试使用备用TTS方法
    if (word) {
      playAudioWithTTS(word);
    }
  }
}

// 使用国内可用的TTS服务播放音频（备用）
function playAudioWithTTS(word) {
  console.log('尝试使用TTS播放单词:', word);

  // 首先尝试使用浏览器内置的Web Speech API
  if ('speechSynthesis' in window) {
    try {
      // 检查是否有可用的语音合成器
      if (window.speechSynthesis.getVoices().length === 0) {
        // 如果没有可用的语音，等待voiceschanged事件
        window.speechSynthesis.onvoiceschanged = function () {
          if (window.speechSynthesis.getVoices().length > 0) {
            playSpeechSynthesis(word);
          } else {
            console.error('没有可用的语音合成器');
            // 尝试使用百度TTS
            tryBaiduTTS(word);
          }
        };
      } else {
        // 直接播放
        playSpeechSynthesis(word);
      }
    } catch (error) {
      console.error('Web Speech API播放失败:', error);
      // 尝试使用百度TTS
      tryBaiduTTS(word);
    }
  } else {
    console.log('浏览器不支持Web Speech API');
    // 尝试使用百度TTS
    tryBaiduTTS(word);
  }

  // 播放Web Speech API
  function playSpeechSynthesis(word) {
    try {
      const speech = new SpeechSynthesisUtterance(word);
      speech.lang = 'en-US';
      speech.rate = 1.0;
      speech.pitch = 1.0;
      speech.volume = 1.0;

      // 播放TTS
      window.speechSynthesis.speak(speech);
      console.log('Web Speech API播放成功:', word);

      // 增加使用计数
      usedWordCount++;
      // 检查是否需要缓存更多音频
      checkAndCacheMoreAudio();
    } catch (error) {
      console.error('Web Speech API播放失败:', error);
      // 尝试使用百度TTS
      tryBaiduTTS(word);
    }
  }

  // 尝试使用百度TTS
  function tryBaiduTTS(word) {
    try {
      // 使用百度TTS API（无需API key的公共接口）
      const ttsUrl = `https://tts.baidu.com/text2audio?lan=en&ie=UTF-8&spd=5&text=${encodeURIComponent(word)}`;
      const audio = new Audio(ttsUrl);

      audio.play().then(() => {
        console.log('百度TTS播放成功:', word);
        // 增加使用计数
        usedWordCount++;
        // 检查是否需要缓存更多音频
        checkAndCacheMoreAudio();
      }).catch(error => {
        console.error('百度TTS播放失败:', error);
      });
    } catch (error) {
      console.error('TTS播放失败:', error);
    }
  }
}

// 加载并播放音频（兼容旧接口）
function loadAndPlayAudio(audioUrl) {
  // 创建音频对象
  const audio = new Audio(audioUrl);
  audio.preload = 'auto';
  audio.volume = 1.0;

  // 添加到缓存
  audioCache.set(audioUrl, audio);

  // 尝试播放音频
  audio.play().then(() => {
    console.log('音频播放成功（新加载）');
    // 增加使用计数
    usedWordCount++;
    // 检查是否需要缓存更多音频
    checkAndCacheMoreAudio();
  }).catch(error => {
    console.error('播放音频失败（新加载）:', error);
    // 失败时使用TTS
    const word = audioUrl.split('/').pop().split('-')[0];
    playAudioWithTTS(word);
  });
}

// 发送缓存更新消息
function sendCacheUpdate() {
  // 更新缓存大小到存储
  chrome.storage.local.set({ cacheSize: audioCache.size }, function () {
    console.log('缓存大小已更新到存储:', audioCache.size);
  });
}

// 检查并缓存更多音频
function checkAndCacheMoreAudio() {
  // 当使用了CACHE_THRESHOLD个单词后，缓存更多
  if (usedWordCount % CACHE_THRESHOLD === 0) {
    console.log(`已使用${usedWordCount}个单词，开始缓存更多音频`);

    // 清除已使用的单词缓存
    if (usedWords.length >= CACHE_THRESHOLD) {
      const wordsToRemove = usedWords.splice(0, CACHE_THRESHOLD);
      wordsToRemove.forEach(word => {
        const cacheKey = `audio_${word}`;
        if (audioCache.has(cacheKey)) {
          audioCache.delete(cacheKey);
          console.log(`清除缓存: ${word}`);
        }
        // 从cachedWordIndices中移除对应的索引
        // 查找单词对应的索引并移除
        const wordIndex = words.findIndex(w => w.word === word);
        if (wordIndex !== -1) {
          cachedWordIndices.delete(wordIndex);
        }
      });
      // 发送缓存更新消息
      sendCacheUpdate();
    }

    // 缓存更多音频
    cacheMoreAudio();
  }
}

// 缓存更多音频
function cacheMoreAudio() {
  // 最多缓存CACHE_SIZE个单词
  if (cachedWordIndices.size >= CACHE_SIZE) {
    console.log('缓存已达到最大容量');
    return;
  }

  // 计算需要缓存的数量
  const needToCache = Math.min(CACHE_THRESHOLD, CACHE_SIZE - cachedWordIndices.size);

  // 错峰创建 Audio，避免一帧内大量创建导致卡顿
  setTimeout(() => {
    let cachedCount = 0;
    const STAGGER_MS = 40;
    const tryCacheOne = () => {
      if (cachedCount >= needToCache || cachedWordIndices.size >= words.length) {
        dbg(`已缓存${cachedWordIndices.size}/${CACHE_SIZE}个单词的音频`);
        sendCacheUpdate();
        return;
      }
      const randomIndex = Math.floor(Math.random() * words.length);
      if (!cachedWordIndices.has(randomIndex)) {
        const wordData = words[randomIndex];
        if (wordData && wordData.word) {
          const audioUrl = audioApi + encodeURIComponent(wordData.word);
          const audio = new Audio(audioUrl);
          audio.preload = 'auto';
          audioCache.set(`audio_${wordData.word}`, audio);
          cachedWordIndices.add(randomIndex);
          cachedCount++;
          dbg(`预缓存单词: ${wordData.word}`);
        }
      }
      setTimeout(tryCacheOne, STAGGER_MS);
    };
    tryCacheOne();
  }, 50);
}

// 初始化缓存（错峰创建 Audio，避免一帧内大量创建导致卡顿）
function initAudioCache() {
  dbg('开始初始化音频缓存');
  const STAGGER_MS = 40; // 每个音频间隔，避免主线程阻塞
  setTimeout(() => {
    let cachedCount = 0;
    const tryCacheOne = () => {
      if (cachedCount >= INITIAL_CACHE_COUNT || cachedWordIndices.size >= words.length) {
        dbg(`初始化完成，已缓存${cachedWordIndices.size}个单词的音频`);
        sendCacheUpdate();
        return;
      }
      const randomIndex = Math.floor(Math.random() * words.length);
      if (!cachedWordIndices.has(randomIndex)) {
        const wordData = words[randomIndex];
        if (wordData && wordData.word) {
          const audioUrl = audioApi + encodeURIComponent(wordData.word);
          const audio = new Audio(audioUrl);
          audio.preload = 'auto';
          audioCache.set(`audio_${wordData.word}`, audio);
          cachedWordIndices.add(randomIndex);
          cachedCount++;
          dbg(`预缓存单词: ${wordData.word}`);
        }
      }
      setTimeout(tryCacheOne, STAGGER_MS);
    };
    tryCacheOne();
  }, 100);
}

// 监听鼠标点击事件
function setupClickListener() {
  console.log('设置点击事件监听器');
  // 使用捕获阶段的事件监听，确保在B站首页也能捕获到点击事件
  document.addEventListener('click', (e) => {
    if (!popwordEnabled) return;
    // 只有当nextKey设置为"鼠标左键"时，才启用鼠标左键触发
    if (nextKey !== '鼠标左键') {
      return;
    }

    console.log('点击事件捕获，目标:', e.target.tagName);
    console.log('目标类名:', e.target.className);
    console.log('目标ID:', e.target.id);
    // 避免在输入框、按钮等元素上触发
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') {
      console.log('点击目标是输入框/文本域/按钮，跳过');
      return;
    }

    // 避免在B站的特殊元素上触发，如播放器、导航栏等
    if (e.target.closest('.bilibili-player') || e.target.closest('.nav-menu') || e.target.closest('.header')) {
      console.log('点击目标是B站特殊元素，跳过');
      return;
    }

    console.log('触发showWordEffect函数（左键，下一个单词）');
    showWordEffect(e.clientX, e.clientY, 'next');
  }, true); // 使用捕获阶段

  // 添加右键点击事件监听
  document.addEventListener('contextmenu', (e) => {
    if (!popwordEnabled) return;
    // 只有当prevKey设置为"鼠标右键"时，才启用鼠标右键触发
    if (prevKey !== '鼠标右键') {
      return;
    }

    console.log('右键点击事件捕获，目标:', e.target.tagName);
    // 避免在输入框、按钮等元素上触发
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') {
      console.log('点击目标是输入框/文本域/按钮，跳过');
      return;
    }

    // 避免在B站的特殊元素上触发，如播放器、导航栏等
    if (e.target.closest('.bilibili-player') || e.target.closest('.nav-menu') || e.target.closest('.header')) {
      console.log('点击目标是B站特殊元素，跳过');
      return;
    }

    // 阻止默认右键菜单
    e.preventDefault();
    console.log('触发showWordEffect函数（右键，上一个单词）');
    showWordEffect(e.clientX, e.clientY, 'prev');
  }, true); // 使用捕获阶段

  // 添加键盘事件监听
  document.addEventListener('keydown', (e) => {
    if (!popwordEnabled) return;
    // 避免在输入框中触发
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      return;
    }

    // 检查是否按下了自定义的下一个单词按键
    if (nextKey && e.key === nextKey) {
      console.log('按下了下一个单词按键:', nextKey);
      // 获取鼠标当前位置作为显示位置
      const x = window.innerWidth / 2;
      const y = window.innerHeight / 2;
      showWordEffect(x, y, 'next');
    }

    // 检查是否按下了自定义的上一个单词按键
    if (prevKey && e.key === prevKey) {
      console.log('按下了上一个单词按键:', prevKey);
      // 获取鼠标当前位置作为显示位置
      const x = window.innerWidth / 2;
      const y = window.innerHeight / 2;
      showWordEffect(x, y, 'prev');
    }
  }, true); // 使用捕获阶段

  console.log('点击事件监听器设置完成（使用捕获阶段）');
}

// 初始化
async function init() {
  console.log('开始初始化插件');

  console.log('加载单词库');
  await loadWords();
  console.log('单词库加载完成，大小:', words.length);

  console.log('加载设置');
  await loadSettings();
  console.log('设置加载完成，showBoth:', showBoth, 'playAudioEnabled:', playAudioEnabled, 'fadeTime:', fadeTime);

  console.log('设置点击事件监听器');
  setupClickListener();

  // 初始化音频缓存
  console.log('初始化音频缓存');
  initAudioCache();

  // 监听设置变化
  console.log('设置存储变化监听器');
  chrome.storage.onChanged.addListener(function (changes, namespace) {
    console.log('存储变化:', changes);
    if (changes.showBoth) {
      showBoth = changes.showBoth.newValue;
      console.log('showBoth更新为:', showBoth);
    }
    if (changes.playAudio) {
      playAudioEnabled = changes.playAudio.newValue;
      console.log('playAudioEnabled更新为:', playAudioEnabled);
    }
    if (changes.fadeTime) {
      fadeTime = changes.fadeTime.newValue;
      console.log('fadeTime更新为:', fadeTime);
    }
    if (changes.wordLibrary) {
      wordLibrary = changes.wordLibrary.newValue;
      dbg('wordLibrary更新为:', wordLibrary);
      // 先落盘再重载，避免丢失进度
      if (savePositionTimer) { clearTimeout(savePositionTimer); savePosition(); }
      flushWordMemoryQueue();
      loadWords().then(() => {
        // 重新初始化音频缓存
        cachedWordIndices.clear();
        usedWordCount = 0;
        initAudioCache();
      });
    }
    if (changes.audioApi) {
      audioApi = changes.audioApi.newValue || 'https://dict.youdao.com/dictvoice?type=0&audio=';
      console.log('audioApi更新为:', audioApi);
      // 重新初始化音频缓存
      audioCache.clear();
      cachedWordIndices.clear();
      usedWordCount = 0;
      initAudioCache();
    }
    if (changes.nextKey) {
      nextKey = changes.nextKey.newValue || '';
      console.log('nextKey更新为:', nextKey);
    }
    if (changes.prevKey) {
      prevKey = changes.prevKey.newValue || '';
      console.log('prevKey更新为:', prevKey);
    }
    if (changes.popwordEnabled !== undefined) {
      popwordEnabled = changes.popwordEnabled.newValue !== false;
      dbg('popwordEnabled更新为:', popwordEnabled);
    }
  });

  // 监听来自popup的消息
  console.log('设置消息监听器');
  chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    console.log('收到消息:', request);
    if (request.action === 'setEnabled') {
      popwordEnabled = request.enabled === true;
      sendResponse({ success: true });
      return;
    }
    if (request.action === 'clearCache') {
      // 清除缓存
      audioCache.clear();
      cachedWordIndices.clear();
      usedWordCount = 0;
      // 清空历史记录
      wordHistory = [];
      historyIndex = -1;
      console.log('缓存已清除，历史记录已清空');
      sendResponse({ success: true });
      // 发送缓存更新消息
      sendCacheUpdate();
    } else if (request.action === 'getCacheSize') {
      // 获取缓存大小
      const cacheSize = audioCache.size;
      console.log('获取缓存大小:', cacheSize);
      sendResponse({ size: cacheSize });
    } else if (request.action === 'resetLibrary') {
      // 重置词库
      currentWordIndex = 0; // 重置为第一个单词
      // 清空音频缓存
      audioCache.clear();
      cachedWordIndices.clear();
      usedWordCount = 0;
      // 重新初始化缓存
      initAudioCache();
      console.log('词库已重置，从第一个单词开始');
      sendResponse({ success: true });
      // 发送缓存更新消息
      sendCacheUpdate();
    } else if (request.action === 'reloadLibrary') {
      if (savePositionTimer) { clearTimeout(savePositionTimer); savePosition(); }
      flushWordMemoryQueue();
      loadSettings().then(() => {
        return loadWords();
      }).then(() => {
        // 清空音频缓存
        audioCache.clear();
        cachedWordIndices.clear();
        usedWordCount = 0;
        // 重新初始化缓存
        initAudioCache();
        console.log('词库已重新加载');
        sendResponse({ success: true });
        // 发送缓存更新消息
        sendCacheUpdate();
      }).catch(error => {
        console.error('重新加载词库失败:', error);
        sendResponse({ success: false });
      });
      return true; // 表示异步响应
    }
  });

  console.log('插件初始化完成');
}

init();
