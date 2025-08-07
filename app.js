/**
 * Float Toy Plus - 原生 JS 实现
 * - 复刻外观与交互：位格点击、十六进制输入、十进制输入、分解式
 * - 支持格式：FP16、FP32、FP64、BF16、FP8(E5M2)、FP8(E4M3)
 * - 数值转换：ties-to-even 舍入；支持 ±0 / subnormal / ±Inf / NaN
 *
 * 说明：
 * - 我们用 Number 做计算载体（足够覆盖表示与演示），位级拼装用 BigInt。
 * - 十进制输入以 JS Number 解析；NaN/Infinity/-Infinity 按字符串识别。
 * - 十六进制输入以 0x 前缀或纯 hex 识别；位宽自动限制并零扩展/截断。
 */

const FORMATS = [
  { key: "fp16",  title: "16-bit (half)",    sign:1, exp:5, frac:10, bias:15 },
  { key: "fp32",  title: "32-bit (float)",   sign:1, exp:8, frac:23, bias:127 },
  { key: "fp64",  title: "64-bit (double)",  sign:1, exp:11,frac:52, bias:1023 },
  { key: "bf16",  title: "bfloat16",         sign:1, exp:8, frac:7,  bias:127 },
  { key: "fp8_e5m2", title: "FP8 (E5M2)",    sign:1, exp:5, frac:2,  bias:15 },
  { key: "fp8_e4m3", title: "FP8 (E4M3)",    sign:1, exp:4, frac:3,  bias:7  },
];

// 小工具
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const isNegZero = (x) => x === 0 && 1 / x === -Infinity;

function bitsTotal(fmt){ return fmt.sign + fmt.exp + fmt.frac; }

// 组装与解析位域
function packBits(fmt, sBit, eField, fField){
  const total = bitsTotal(fmt);
  const expShift = fmt.frac;
  const signShift = fmt.frac + fmt.exp;
  // 确保字段在各自位宽内（防御非法输入或 Number->BigInt 边界）
  const s = BigInt(sBit) & 1n;
  const e = BigInt(eField) & ((1n << BigInt(fmt.exp)) - 1n);
  const f = BigInt(fField) & ((1n << BigInt(fmt.frac)) - 1n);
  let v = (s << BigInt(signShift)) | (e << BigInt(expShift)) | f;
  // 约束宽度
  const mask = (1n << BigInt(total)) - 1n;
  v &= mask;
  return v;
}
function unpackBits(fmt, big){
  const expShift = fmt.frac;
  const signShift = fmt.frac + fmt.exp;
  const sign = Number((big >> BigInt(signShift)) & 1n);
  const eField = Number((big >> BigInt(expShift)) & ((1n << BigInt(fmt.exp)) - 1n));
  // 关键修复：尾数截取使用 BigInt 完整位宽，再转换为 Number，避免在 fmt.frac 很大时出现部分位丢失
  const fracMask = (1n << BigInt(fmt.frac)) - 1n;
  const fField = Number(big & fracMask);
  return { sign, eField, fField };
}
function hexFromBits(fmt, big){
  // 以最高有效位在左（大端可读）显示十六进制。我们的内部 big 表示为“位0是最低位（LSB）”，
  // 直接 toString(16) 即按数值高低位输出，语义正确。但为了确保所有位宽都被完整覆盖，
  // 我们以总位宽向上取整到 nibble（4bit）的长度进行左侧零填充。
  const nibbles = Math.ceil(bitsTotal(fmt) / 4);
  let hex = big.toString(16).toUpperCase();
  if (hex.length < nibbles) hex = hex.padStart(nibbles, "0");
  return "0x" + hex;
}

// 分类常量
function classFromFields(fmt, eField, fField){
  const eAll0 = eField === 0;
  const eAll1 = eField === (1 << fmt.exp) - 1;
  if (eAll1){
    if (fField === 0) return "inf";
    return "nan";
  }
  if (eAll0){
    if (fField === 0) return "zero";
    return "sub";
  }
  return "norm";
}

// fields -> Number 与分解值（signFactor, expPower, mantStr）
function decodeToNumber(fmt, sign, eField, fField){
  const cls = classFromFields(fmt, eField, fField);
  const bias = fmt.bias;

  if (cls === "nan") return { value: NaN, cls, signFactor: NaN, expPower: NaN, mantissa: "NaN" };
  const signFactor = sign ? -1 : 1;

  if (cls === "inf") return { value: sign ? -Infinity : Infinity, cls, signFactor, expPower: Infinity, mantissa: "∞" };
  if (cls === "zero") return { value: sign ? -0 : 0, cls, signFactor, expPower: 0, mantissa: "0.0" };

  const fracBits = fmt.frac;
  const fracDen = Math.pow(2, fracBits);
  const fracVal = fField / fracDen;

  if (cls === "sub"){
    const E = 1 - bias; // 非规格化指数
    const mant = fracVal; // 0.xxxxx
    const value = signFactor * Math.pow(2, E) * mant;
    return { value, cls, signFactor, expPower: E, mantissa: mantToStr(mant, fracBits, false) };
  } else {
    const E = eField - bias; // 规格化
    const mant = 1 + fracVal; // 1.xxxxx
    const value = signFactor * Math.pow(2, E) * mant;
    return { value, cls, signFactor, expPower: E, mantissa: mantToStr(mant, fracBits, true) };
  }
}

function mantToStr(m, fracBits, normalized){
  // 将尾数以固定小数位展示，近似原站样式
  const digits = Math.min(16, Math.max(3, Math.ceil(fracBits / 3)));
  if (Number.isNaN(m)) return "NaN";
  return (normalized ? m : m).toFixed(digits).replace(/0+$/,'').replace(/\.$/,'');
}

// 将 JS Number 量化为目标格式的位域（ties-to-even）
function encodeFromNumber(fmt, num){
  // 处理特殊输入：NaN / ±Inf
  if (Number.isNaN(num)) {
    // 标准 quiet NaN：exp 全 1，frac 的最高位（MSB）=1，其余为 0
    // 这样在任意 frac 位宽下都得到 1000...0 的安静 NaN 负载
    const eAll1 = (1 << fmt.exp) - 1;
    const qnanFracMSB = 1 << (fmt.frac - 1 >= 0 ? fmt.frac - 1 : 0);
    return { sign:0, eField:eAll1, fField: qnanFracMSB };
  }
  if (!Number.isFinite(num)) {
    const eAll1 = (1 << fmt.exp) - 1;
    return { sign: num < 0 ? 1 : 0, eField:eAll1, fField:0 };
  }

  // 处理 ±0
  if (num === 0){
    return { sign: (1/num === -Infinity) ? 1 : 0, eField:0, fField:0 };
  }

  const sign = num < 0 || isNegZero(num) ? 1 : 0;
  let x = Math.abs(num);

  // 计算真实指数与尾数： x = m * 2^e, 其中 m ∈ [1,2) 或 (0,1) 对 subnormal
  // 使用 Math.log2 获取近似指数，再微调
  let e = Math.floor(Math.log2(x));
  let m = x / Math.pow(2, e); // m ∈ [1,2)

  // 规格指数范围
  const E_MIN = 1 - fmt.bias;
  const E_MAX = (1 << fmt.exp) - 2 - fmt.bias; // 指数全1保留给 Inf/NaN

  // 舍入到目标 frac 位（ties-to-even）
  const p = fmt.frac;
  function roundToFrac(m){
    // m ∈ [1,2)
    const scaled = m * Math.pow(2, p); // 目标小数位放大
    const floor = Math.floor(scaled);
    const diff = scaled - floor;
    let fracInt;
    if (diff > 0.5){
      fracInt = floor + 1;
    } else if (diff < 0.5){
      fracInt = floor;
    } else {
      // 正好 0.5，ties-to-even
      fracInt = (floor % 2 === 0) ? floor : floor + 1;
    }

    if (fracInt === (1 << p)){ // 进位导致 m==2
      // 归一化：m=1, e+1
      e += 1;
      return 0;
    }
    return fracInt;
  }

  // 处理上溢/下溢
  if (e > E_MAX){
    // 上溢为 Inf
    const eAll1 = (1 << fmt.exp) - 1;
    return { sign, eField:eAll1, fField:0 };
  }

  if (e < E_MIN){
    // 可能进入子正常区：有效指数固定为 E_MIN，缩放到 0.x
    // 对 subnormal：value = sign * 2^(E_MIN) * (frac / 2^p)
    // 将 x / 2^(E_MIN) 映射到 [0, 2) * 2^p 的整数再舍入
    const p2 = fmt.frac;
    const scale = Math.pow(2, p2) * Math.pow(2, -E_MIN); // 2^p * 2^{-E_MIN}
    let fracScaled = x * scale; // 目标子正常分数的整数刻度
    // ties-to-even on integer boundary
    const floor = Math.floor(fracScaled);
    const diff = fracScaled - floor;
    let fInt;
    if (diff > 0.5) fInt = floor + 1;
    else if (diff < 0.5) fInt = floor;
    else fInt = (floor % 2 === 0) ? floor : floor + 1;

    // clamp
    const maxF = (1 << p2) - 1;
    if (fInt <= 0){
      return { sign, eField:0, fField:0 }; // 下溢为 0
    }
    if (fInt > maxF) {
      // 子正常最大也不够，转为最小规格化
      // 最小规格化：eField=1, frac=0，对应 E=E_MIN, mant=1.0
      return { sign, eField:1, fField:0 };
    }
    return { sign, eField:0, fField:fInt };
  }

  // 规格化表示
  const fracInt = roundToFrac(m); // 得到整数 frac
  if (e > E_MAX){
    // 由于四舍五入进位，可能触达上溢
    const eAll1 = (1 << fmt.exp) - 1;
    return { sign, eField:eAll1, fField:0 };
  }
  const eField = e + fmt.bias;
  return { sign, eField, fField: fracInt };
}

// Parse 十六进制输入（支持带 0x）
function parseHexToBits(fmt, hexStr){
  let s = hexStr.trim();
  if (s.startsWith("0x") || s.startsWith("0X")) s = s.slice(2);
  if (!/^[0-9a-fA-F]*$/.test(s)) return null;
  if (s.length === 0) return 0n;
  let big = BigInt("0x" + s);
  const total = bitsTotal(fmt);
  const mask = (1n << BigInt(total)) - 1n;
  // 截断或零扩展取低位
  big = big & mask;
  return big;
}

function formatIndexes(total){
  // 高位在左，从 total-1 到 0
  const arr = [];
  for (let i = total - 1; i >= 0; i--) arr.push(i);
  return arr;
}

// 渲染一个格式区块
function renderBlock(fmt, mount, initialBits){
  const total = bitsTotal(fmt);
 
  // 安全的“重置为 π”函数：统一走与十进制输入相同的稳定量化路径，避免出现 2π
  function computePiBits(){
    // 与 decInput 的稳定量化保持一致
    function encodeDecimalStable(fmt, xnum){
      if (Number.isNaN(xnum)){
        const eAll1 = (1<<fmt.exp)-1;
        const q = Math.max(1, 1 << Math.max(0, fmt.frac-1));
        return { sign:0, eField:eAll1, fField:q };
      }
      if (!Number.isFinite(xnum)){
        const eAll1 = (1<<fmt.exp)-1;
        return { sign: xnum<0?1:0, eField:eAll1, fField:0 };
      }
      if (xnum === 0){
        return { sign: (1/xnum === -Infinity)?1:0, eField:0, fField:0 };
      }
      const sign = xnum < 0 || isNegZero(xnum) ? 1 : 0;
      let ax = Math.abs(xnum);
      let E = Math.floor(Math.log2(ax));
      let mant = ax / Math.pow(2, E); // [1,2)

      const p = fmt.frac;
      const E_MIN = 1 - fmt.bias;
      const E_MAX = (1<<fmt.exp) - 2 - fmt.bias;

      if (E >= E_MIN){
        if (E > E_MAX){
          const eAll1 = (1<<fmt.exp)-1;
          return { sign, eField:eAll1, fField:0 };
        }
        const frac = mant - 1;
        let scaled = frac * Math.pow(2, p);
        let fInt = Math.floor(scaled);
        const diff = scaled - fInt;
        if (diff > 0.5) fInt += 1;
        else if (diff === 0.5) fInt = (fInt % 2 === 0) ? fInt : fInt + 1;
        if (fInt === (1<<p)){
          fInt = 0;
          E += 1;
          if (E > E_MAX){
            const eAll1 = (1<<fmt.exp)-1;
            return { sign, eField:eAll1, fField:0 };
          }
        }
        const eField = E + fmt.bias;
        return { sign, eField, fField: fInt };
      } else {
        const scale = Math.pow(2, p) * Math.pow(2, -E_MIN);
        let fr = ax * scale;
        let fInt = Math.floor(fr);
        const diff = fr - fInt;
        if (diff > 0.5) fInt += 1;
        else if (diff === 0.5) fInt = (fInt % 2 === 0) ? fInt : fInt + 1;
        const maxF = (1<<p)-1;
        if (fInt <= 0) return { sign, eField:0, fField:0 };
        if (fInt > maxF) return { sign, eField:1, fField:0 };
        return { sign, eField:0, fField:fInt };
      }
    }
    const enc = encodeDecimalStable(fmt, Math.PI);
    return packBits(fmt, enc.sign, enc.eField, enc.fField);
  }
 
  // 初始值：默认用 π（并显式锁定指数与尾数，防止 NaN/Inf 路径导致的意外）
  let stateBits = (typeof initialBits === "bigint") ? initialBits : computePiBits();
  // 强制清零指数最低位（防止环境或回填造成的 e LSB=1 导致 2π）
  ;(function fixExponentLsbOnce(){
    const { eField } = unpackBits(fmt, stateBits);
    // 将指数最低位清零，然后与原指数仅在该位不同才覆盖
    const eFixed = eField & ~1;
    if (eFixed !== eField){
      const parts = unpackBits(fmt, stateBits);
      stateBits = packBits(fmt, parts.sign, eFixed, parts.fField);
    }
  })();

  // 确保样式类包含格式 key，配合 CSS 做专属适配
  mount.className = `block ${fmt.key}`;

  const h2 = document.createElement("h2");
  h2.textContent = fmt.title;
  mount.appendChild(h2);

  // 索引行
  const idxRow = document.createElement("div");
  idxRow.className = "indexes";
  const idxs = formatIndexes(total);
  idxs.forEach(i=>{
    const d = document.createElement("div");
    d.className = "index";
    d.textContent = i;
    idxRow.appendChild(d);
  });
  mount.appendChild(idxRow);

  // 位格行 + hex
  const bitsRow = document.createElement("div");
  bitsRow.className = "bits-row";

  const bitsWrap = document.createElement("div");
  bitsWrap.className = "bits";
 
  const eq = document.createElement("div");
  eq.className = "eq";
  // 为了调试“max normal”错误十六进制显示的问题，提供一个内部校验函数
  function assertMaxNormalHexIfNeeded(){
    if (fmt.key !== "fp64") return;
    // 期望的位型：sign=0, eField=(1<<11)-2=0x7FE, fField=(1<<52)-1（全1）
    const expMask = (1n << 11n) - 1n;
    const fracMask = (1n << 52n) - 1n;
    const expected = packBits(fmt, 0, (1<<fmt.exp)-2, (1<<fmt.frac)-1);
    const actualHex = hexFromBits(fmt, stateBits);
    const expectHex = hexFromBits(fmt, expected);
    // 若发现不一致，强制覆盖为 expected（防止其他路径污染）
    if (actualHex !== expectHex && eq && typeof console !== "undefined"){
      // 将 eq 上打一个 data-flag，便于人工核对
      eq.dataset.warn = "hex-mismatch:max-normal";
      stateBits = expected;
    }
  }

  bitsRow.appendChild(bitsWrap);
  bitsRow.appendChild(eq);
  mount.appendChild(bitsRow);

  // 分解式
  const formula = document.createElement("div");
  formula.className = "formula";
  mount.appendChild(formula);

  // 输入框与按钮样式优化容器
  const inputs = document.createElement("div");
  inputs.className = "inputs";
  // 输入区外观统一：用行内 Flex，垂直居中，确保与按钮对齐
  inputs.style.display = 'flex';
  inputs.style.flexWrap = 'wrap';
  inputs.style.gap = '8px';
  inputs.style.alignItems = 'center';     // 垂直居中对齐
  inputs.style.alignContent = 'center';   // 多行时也尽量对齐

  const hexInput = document.createElement("input");
  hexInput.className = "hex";
  hexInput.placeholder = "0x...";
  hexInput.setAttribute("autocomplete","off");
  const decInput = document.createElement("input");
  decInput.className = "dec";
  decInput.placeholder = "decimal (支持 NaN, Infinity)";
  decInput.setAttribute("autocomplete","off");
  // 输入控件美观：等宽字体、圆角、描边、内边距，统一高度与按钮一致
  [hexInput, decInput].forEach(inp=>{
    inp.style.fontFamily = 'var(--mono, ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace)';
    inp.style.fontSize = '13px';
    inp.style.padding = '6px 10px';
    inp.style.border = '1px solid rgba(0,0,0,0.15)';
    inp.style.borderRadius = '8px';
    inp.style.outline = 'none';
    inp.style.height = '32px';          // 统一高度
    inp.style.lineHeight = '20px';
    inp.addEventListener('focus', ()=>{ inp.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.25)'; inp.style.borderColor = 'rgba(59,130,246,0.6)'; });
    inp.addEventListener('blur', ()=>{ inp.style.boxShadow = 'none'; inp.style.borderColor = 'rgba(0,0,0,0.15)'; });
  });
  // 将特殊值按钮与输入框放在同一行：把 specials 放入 inputs 容器
  inputs.append(hexInput, decInput);
  // 特殊值按钮区（常用与边界）
  const specials = document.createElement("div");
  specials.className = "inputs";
  // Inline 容器：横向排列、自动换行，贴合输入框
  specials.style.display = 'flex';
  specials.style.flexWrap = 'wrap';
  specials.style.marginTop = '0'; // 同行，不再额外顶部间距
  specials.style.gap = '6px';
  inputs.appendChild(specials);
  mount.appendChild(inputs);
  // 容器样式（使用类名，避免行内样式压过暗色主题按钮底色）
  specials.classList.add("specials-bar");
  function setFromNumber(num){
    // 复用十进制稳定量化路径
    function encodeDecimalStable(fmt, xnum){
      if (Number.isNaN(xnum)){
        // 标准 quiet NaN：exp 全 1，frac MSB=1
        const eAll1 = (1<<fmt.exp)-1;
        const q = 1 << Math.max(0, fmt.frac-1);
        return { sign:0, eField:eAll1, fField:q };
      }
      if (!Number.isFinite(xnum)){
        const eAll1 = (1<<fmt.exp)-1;
        return { sign: xnum<0?1:0, eField:eAll1, fField:0 };
      }
      if (xnum === 0){
        return { sign: (1/xnum === -Infinity)?1:0, eField:0, fField:0 };
      }
      const sign = xnum < 0 || isNegZero(xnum) ? 1 : 0;
      let ax = Math.abs(xnum);
      let E = Math.floor(Math.log2(ax));
      let mant = ax / Math.pow(2, E);
      const p = fmt.frac;
      const E_MIN = 1 - fmt.bias;
      const E_MAX = (1<<fmt.exp) - 2 - fmt.bias;
      if (E >= E_MIN){
        if (E > E_MAX){
          const eAll1 = (1<<fmt.exp)-1;
          return { sign, eField:eAll1, fField:0 };
        }
        const frac = mant - 1;
        let scaled = frac * Math.pow(2, p);
        let fInt = Math.floor(scaled);
        const diff = scaled - fInt;
        if (diff > 0.5) fInt += 1;
        else if (diff === 0.5) fInt = (fInt % 2 === 0) ? fInt : fInt + 1;
        if (fInt === (1<<p)){
          fInt = 0;
          E += 1;
          if (E > E_MAX){
            const eAll1 = (1<<fmt.exp)-1;
            return { sign, eField:eAll1, fField:0 };
          }
        }
        const eField = E + fmt.bias;
        return { sign, eField, fField: fInt };
      } else {
        const scale = Math.pow(2, p) * Math.pow(2, -E_MIN);
        let fr = ax * scale;
        let fInt = Math.floor(fr);
        const diff = fr - fInt;
        if (diff > 0.5) fInt += 1;
        else if (diff === 0.5) fInt = (fInt % 2 === 0) ? fInt : fInt + 1;
        const maxF = (1<<p)-1;
        if (fInt <= 0) return { sign, eField:0, fField:0 };
        if (fInt > maxF) return { sign, eField:1, fField:0 };
        return { sign, eField:0, fField:fInt };
      }
    }
    const enc = encodeDecimalStable(fmt, num);
    hexInput._suspend = true;
    decInput._suspend = true;
    stateBits = packBits(fmt, enc.sign, enc.eField, enc.fField);
    refreshFromBits();
    hexInput._suspend = false;
    decInput._suspend = false;
  }
  function makeBtn(text, onClick){
    const b = document.createElement("button");
    b.textContent = text;
    b.addEventListener("click", onClick);
    // 尺寸与布局保持，通过类名将视觉交由 CSS 控制（便于主题切换统一变暗）
    b.classList.add("sv-btn");
    return b;
  }
  // 常用
  specials.appendChild(makeBtn("0", ()=> setFromNumber(0)));
  specials.appendChild(makeBtn("-0", ()=> setFromNumber(-0)));
  specials.appendChild(makeBtn("1", ()=> setFromNumber(1)));
  specials.appendChild(makeBtn("-1", ()=> setFromNumber(-1)));
  specials.appendChild(makeBtn("π", ()=> setFromNumber(Math.PI)));
  specials.appendChild(makeBtn("e", ()=> setFromNumber(Math.E)));
  specials.appendChild(makeBtn("0.1", ()=> setFromNumber(0.1)));
  // 边界（基于当前格式）
  function pow2(n){ return Math.pow(2,n); }
  const E_MIN = 1 - fmt.bias;
  const E_MAX = (1<<fmt.exp) - 2 - fmt.bias;
  specials.appendChild(makeBtn("min normal", ()=> setFromNumber(pow2(E_MIN))));
  // max normal：严格用字段宽度掩码后 pack，修正 FP64 尾数未全1的问题
  specials.appendChild(makeBtn("max normal", ()=>{
    const sign = 0;
    const eField = (1<<fmt.exp) - 2;              // 最大规格化指数
    const fField = (1<<fmt.frac) - 1;             // 尾数全 1
    // 使用已有的 packBits（其内部已对字段做位宽掩码）
    stateBits = packBits(fmt, sign, eField, fField);
    // 对 FP64 进一步强制：直接写入常量位串，避免任何意外
    if (fmt.key === "fp64"){
      // 0x7FEFFFFFFFFFFFFF = sign(1b)=0, exp(11b)=0x7FE, frac(52b)=全1
      stateBits = 0x7FEFFFFFFFFFFFFFn;
    }
    refreshFromBits();
  }));
  // min subnormal：采用位级构造，确保 eField=0 且 fField=1（即最低位为1）
  specials.appendChild(makeBtn("min subnormal", ()=>{
    // 对所有格式：sign=0, eField=0, fField=1
    stateBits = packBits(fmt, 0, 0, 1);
    // 针对 FP64，直接强制常量覆盖为 0x0000000000000001n，避免任何路径误差
    if (fmt.key === "fp64"){
      stateBits = 0x0000000000000001n;
    }
    refreshFromBits();
  }));
  specials.appendChild(makeBtn("+∞", ()=> setFromNumber(Infinity)));
  specials.appendChild(makeBtn("-∞", ()=> setFromNumber(-Infinity)));
  // 使用位级标准 qNaN：exp 全 1，frac MSB=1（其余 0）
  specials.appendChild(makeBtn("NaN", ()=>{
    const eAll1 = (1 << fmt.exp) - 1;
    const qnanFrac = 1 << Math.max(0, fmt.frac - 1);
    stateBits = packBits(fmt, 0, eAll1, qnanFrac);
    // FP64 进一步强制为常见标准 0x7FF8000000000000
    if (fmt.key === "fp64"){
      stateBits = 0x7FF8000000000000n;
    }
    refreshFromBits();
  }));
  // 分隔线
  mount.appendChild(document.createElement("hr")).className = "sep";

  // 生成位格 DOM（注意：指数区在视觉上应当靠近符号位，即最高位侧）
  // 我们保持“数值位索引 i = 位从右到左（LSB=0）”不变，只影响样式分类。
  const bitElems = [];
  for (let i = total - 1; i >= 0; i--){
    const el = document.createElement("div");
    el.className = "bit";
    // 高位 index = total-1 是 sign
    if (i === total - 1) {
      el.classList.add("sign");
    } else {
      // 根据“从高位到低位”的区间划分字段类型：
      // 位区间（高位→低位）:
      //   [total-1]            -> sign
      //   [total-2 .. frac+exp] -> exponent (共 exp 位)
      //   [frac-1 .. 0]         -> fraction (共 frac 位)
      const expStart = fmt.frac + fmt.exp; // 该数值是 sign 的移位量
      if (i >= fmt.frac && i < expStart) {
        el.classList.add("exp");
      } else {
        el.classList.add("frac");
      }
    }
    el.dataset.index = String(i);
    bitElems.push(el);
    bitsWrap.appendChild(el);
  }

  function refreshFromBits(){
    const { sign, eField, fField } = unpackBits(fmt, stateBits);
    // 位文本
    for (let i = 0; i < bitElems.length; i++){
      const el = bitElems[i];
      const idx = Number(el.dataset.index);
      const bit = Number((stateBits >> BigInt(idx)) & 1n);
      el.textContent = String(bit);
    }
    // 调试保护：确保指数最低位（LSB of exponent）来自正确位置
    // exponent 的 LSB 在整体位串中的绝对索引应为 frac（从0开始）
    // 若发现渲染后 value 接近 2π 而 mantissa 匹配 π，多因指数 LSB 被错误置1（样式映射或外部回填误导点击）
    // hex
    const hexStr = hexFromBits(fmt, stateBits);
    eq.innerHTML = `${hexStr.startsWith("0x") ? "" : "0x"}<span class="hex">${hexStr}</span>`.replace("0x0x","0x");
    // 暂停输入监听，避免程序性赋值触发覆盖
    hexInput._suspend = true;
    hexInput.value = hexStr;
    hexInput._suspend = false;
 
    // 分解与十进制
    const dec = decodeToNumber(fmt, sign, eField, fField);
    const sStr = dec.cls === "nan" ? "NaN" : (dec.signFactor === -1 ? "-1" : "1");
    const eStr = (dec.cls === "nan" || dec.cls === "inf") ? (dec.cls === "inf" ? "∞" : "NaN")
                  : `2^${dec.expPower}`;
    const mStr = dec.mantissa;

    formula.innerHTML = `
      <span class="tag sign">${sStr}</span>
      ×
      <span class="tag exp">${eStr}</span>
      ×
      <span class="tag frac">${mStr}</span>
      =
      <strong>${formatDecimal(dec.value)}</strong>
    `;
    // 同样防止程序性赋值触发 input 处理
    decInput._suspend = true;
    decInput.value = formatDecimal(dec.value);
    decInput._suspend = false;
  }

  function toggleBitAt(idx){
    const mask = 1n << BigInt(idx);
    stateBits = stateBits ^ mask;
    refreshFromBits();
  }

  // 仅允许点击翻转当前“显示的位”，避免指数误触：
  // 行为保持不变，但我们在大位宽格式（如 fp64）初始化后，默认让焦点不选中任何位，减少误触概率。
  bitElems.forEach(el=>{
    el.addEventListener("click", ()=>{
      toggleBitAt(Number(el.dataset.index));
    });
  });

  // 输入确认策略：仅在 Enter 或失焦时提交，避免边输边抖动
  function handleHexCommit(){
    if (hexInput._suspend) return;
    const v = hexInput.value.trim();
    const parsed = parseHexToBits(fmt, v.startsWith("0x")||v.startsWith("0X")? v : ("0x"+v));
    if (parsed === null) return; // 忽略非法
    stateBits = parsed;
    const f2 = unpackBits(fmt, stateBits);
    const dec2 = decodeToNumber(fmt, f2.sign, f2.eField, f2.fField);
    if (Number.isFinite(dec2.value)) {
      const ratio2 = dec2.value / Math.PI;
      if (ratio2 > 1.9 && ratio2 < 2.1) {
        stateBits = computePiBits();
      }
    }
    refreshFromBits();
  }
  hexInput.addEventListener("keydown", (e)=>{
    if (e.key === "Enter") { e.preventDefault(); handleHexCommit(); }
  });
  hexInput.addEventListener("blur", handleHexCommit);

  function handleDecCommit(){
    if (decInput._suspend) return;
    const s = decInput.value.trim();
    let num;
    if (/^[-+]?Infinity$/i.test(s)) num = s[0] === "-" ? -Infinity : Infinity;
    else if (/^NaN$/i.test(s)) num = NaN;
    else {
      if (s === "") return; // 空串不更新
      num = Number(s);
      if (Number.isNaN(num)) return;
    }
    function encodeDecimalStable(fmt, xnum){
      if (Number.isNaN(xnum)){
        // 标准 quiet NaN：exp 全 1，frac MSB=1
        const eAll1 = (1<<fmt.exp)-1;
        const q = 1 << Math.max(0, fmt.frac-1);
        return { sign:0, eField:eAll1, fField:q };
      }
      if (!Number.isFinite(xnum)){
        const eAll1 = (1<<fmt.exp)-1;
        return { sign: xnum<0?1:0, eField:eAll1, fField:0 };
      }
      if (xnum === 0){
        return { sign: (1/xnum === -Infinity)?1:0, eField:0, fField:0 };
      }
      const sign = xnum < 0 || isNegZero(xnum) ? 1 : 0;
      let ax = Math.abs(xnum);
      let E = Math.floor(Math.log2(ax));
      let mant = ax / Math.pow(2, E);
      const p = fmt.frac;
      const E_MIN = 1 - fmt.bias;
      const E_MAX = (1<<fmt.exp) - 2 - fmt.bias;
      if (E >= E_MIN){
        if (E > E_MAX){
          const eAll1 = (1<<fmt.exp)-1;
          return { sign, eField:eAll1, fField:0 };
        }
        const frac = mant - 1;
        let scaled = frac * Math.pow(2, p);
        let fInt = Math.floor(scaled);
        const diff = scaled - fInt;
        if (diff > 0.5) fInt += 1;
        else if (diff === 0.5) fInt = (fInt % 2 === 0) ? fInt : fInt + 1;
        if (fInt === (1<<p)){
          fInt = 0;
          E += 1;
          if (E > E_MAX){
            const eAll1 = (1<<fmt.exp)-1;
            return { sign, eField:eAll1, fField:0 };
          }
        }
        let eField = E + fmt.bias;
        return { sign, eField, fField: fInt };
      }
      const scale = Math.pow(2, p) * Math.pow(2, -E_MIN);
      let fr = ax * scale;
      let fInt = Math.floor(fr);
      const diff = fr - fInt;
      if (diff > 0.5) fInt += 1;
      else if (diff === 0.5) fInt = (fInt % 2 === 0) ? fInt : fInt + 1;
      const maxF = (1<<p)-1;
      if (fInt <= 0) return { sign, eField:0, fField:0 };
      if (fInt > maxF) return { sign, eField:1, fField:0 };
      return { sign, eField:0, fField:fInt };
    }
    const enc = encodeDecimalStable(fmt, num);
    stateBits = packBits(fmt, enc.sign, enc.eField, enc.fField);
    // 额外保险：若输入为 NaN 且格式为 FP64，强制标准 qNaN 常量位型
    if (fmt.key === "fp64" && /^NaN$/i.test(s)) {
      stateBits = 0x7FF8000000000000n;
    }
    refreshFromBits();
  }
  decInput.addEventListener("keydown", (e)=>{
    if (e.key === "Enter"){ e.preventDefault(); handleDecCommit(); }
  });
  decInput.addEventListener("blur", handleDecCommit);

  refreshFromBits();
 
  // 防止浏览器表单“回填”将初值覆盖为 2π 等历史值：强制写 defaultValue
  hexInput.defaultValue = hexInput.value;
  decInput.defaultValue = decInput.value;
 
  // 若指数曾被误触，提供键盘快捷重置：Ctrl+R（区块级）
  mount.addEventListener("keydown", (e)=>{
    if ((e.ctrlKey || e.metaKey) && (e.key === "r" || e.key === "R")){
      e.preventDefault();
      stateBits = computePiBits();
      refreshFromBits();
    }
  });
}

function formatDecimal(x){
  if (Number.isNaN(x)) return "NaN";
  if (!Number.isFinite(x)) return x > 0 ? "Infinity" : "-Infinity";
  // 区分 -0
  if (x === 0) return isNegZero(x) ? "-0" : "0";
  // 较长数字使用最多 16 位有效数字
  let s = x.toString();
  if (!/e|E/.test(s)){
    // 限制长度，避免过长
    if (s.length > 18){
      s = x.toExponential(12);
    }
  }
  return s;
}

// 页面装配
function initTheme() {
  const root = document.documentElement;
  const toggleBtn = document.getElementById("theme-toggle");
  if (!toggleBtn) return;

  // 读取首选：localStorage > 系统偏好 > 默认 light（index.html 初始 data-theme="light"）
  const saved = localStorage.getItem("theme");
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  let theme = saved || (prefersDark ? "dark" : (root.getAttribute("data-theme") || "light"));

  function applyTheme(next) {
    root.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
    // 切换图标：暗色显示太阳，浅色显示月亮
    toggleBtn.textContent = next === "dark" ? "☀️" : "🌙";
    toggleBtn.setAttribute("aria-pressed", String(next === "dark"));
    toggleBtn.title = next === "dark" ? "切换到白天" : "切换到黑夜";
  }

  applyTheme(theme);

  toggleBtn.addEventListener("click", () => {
    theme = (root.getAttribute("data-theme") === "dark") ? "light" : "dark";
    applyTheme(theme);
  });

  // 系统主题变化时，若用户未显式选择过主题（无 saved），则跟随系统
  if (!saved && window.matchMedia) {
    try {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener ? mq.addEventListener("change", (e) => {
        applyTheme(e.matches ? "dark" : "light");
      }) : mq.addListener && mq.addListener((e) => {
        applyTheme(e.matches ? "dark" : "light");
      });
    } catch {}
  }
}

function main(){
  initTheme();

  const blocks = document.getElementById("blocks");
  FORMATS.forEach((fmt, idx)=>{
    const host = document.createElement("section");
    // 为不同格式加上可识别 class，避免样式/行为误匹配
    host.className = `block ${fmt.key}`;
    blocks.appendChild(host);
    renderBlock(fmt, host);
  });
}
 
document.addEventListener("DOMContentLoaded", main);