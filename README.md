# BitFloat Explorer

一个用于理解 IEEE 754 等浮点数格式的交互式可视化工具

![BitFloat Explorer](https://img.shields.io/badge/Version-1.0.0-blue.svg)
![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-yellow.svg)
![License](https://img.shields.io/badge/License-MIT-green.svg)

## 🎯 项目简介

BitFloat Explorer 是一个纯原生 JavaScript 实现的浮点数位表示法可视化工具，旨在帮助用户建立对 IEEE 754 及相关浮点数格式的位级直觉。通过交互式界面，用户可以直观地看到浮点数的二进制表示、十六进制表示和十进制表示之间的实时转换。

## ✨ 主要特性

### 🔢 多格式支持
- **IEEE 754 标准格式**
  - FP16 (16-bit half-precision)
  - FP32 (32-bit single-precision) 
  - FP64 (64-bit double-precision)
- **特殊格式**
  - BF16 (bfloat16)
  - FP8 (E5M2)
  - FP8 (E4M3)
- **自定义格式**
  - 支持用户自定义符号位、指数位、小数位
  - 自动生成格式名称 (如: S1E8M0, U0E8M0)
  - 自动计算偏移量

### 🎨 交互功能
- **位级编辑**: 点击位格在 0/1 之间切换
- **多种输入方式**: 
  - 十六进制输入 (0x...)
  - 十进制输入 (支持 NaN, Infinity)
  - 位格点击切换
- **便捷按钮**: 常用值和边界值一键设置
- **实时同步**: 位表示 ↔ 十六进制 ↔ 十进制 ↔ 分解公式

### 🎨 用户体验
- **主题切换**: 支持浅色/深色主题
- **响应式设计**: 适配不同屏幕尺寸
- **实时预览**: 自定义格式添加时的实时预览
- **智能验证**: 输入验证和错误提示

## 🚀 快速开始

### 环境要求
- 现代浏览器 (支持 ES6+)
- 本地 HTTP 服务器 (开发用)

### 安装和运行

1. **克隆项目**
   ```bash
   git clone <repository-url>
   cd floatConverter2
   ```

2. **启动本地服务器**
   ```bash
   # 使用 Python
   python -m http.server 8080
   
   # 或使用 Node.js
   npx http-server -p 8080
   
   # 或使用其他 HTTP 服务器
   ```

3. **访问应用**
   ```
   http://localhost:8080
   ```

## 📖 使用指南

### 基本操作

1. **查看浮点数表示**
   - 每种格式显示位格、十六进制、十进制和分解公式
   - 位格颜色表示不同字段：蓝色(符号位)、绿色(指数位)、粉色(小数位)

2. **编辑数值**
   - **点击位格**: 在 0/1 之间切换
   - **十六进制输入**: 输入 0x... 格式
   - **十进制输入**: 输入普通数字、NaN、Infinity

3. **快捷按钮**
   - **常用值**: 0, -0, 1, -1, π, e, 0.1
   - **边界值**: min normal, max normal, min subnormal, ±∞, NaN

### 自定义格式

1. **添加自定义格式**
   - 在 FP8(E4M3) 后找到"添加自定义格式"区域
   - 选择符号位: 无符号(0位) 或 有符号(1位)
   - 设置指数位数 (0-32)
   - 设置小数位数 (0-32)
   - 查看实时预览，点击"添加格式"

2. **格式命名规则**
   ```
   [S|U][符号位数]E[指数位数]M[小数位数]
   
   示例:
   - S1E8M0: 有符号1位，指数8位，小数0位
   - U0E8M0: 无符号0位，指数8位，小数0位
   ```

3. **删除自定义格式**
   - 点击自定义格式标题旁的"删除"按钮

### 键盘快捷键
- **Enter**: 在输入框中快速提交
- **Ctrl+R**: 重置当前格式为 π 值

## 🏗️ 技术架构

### 技术栈
- **前端**: 纯原生 JavaScript (ES6+)
- **样式**: 原生 CSS3 (支持 CSS 变量)
- **无外部依赖**: 完全自包含

### 核心模块

1. **格式管理** (`FORMATS`, `CustomFormatManager`)
   - 内置格式定义
   - 自定义格式的增删改查
   - 格式验证和名称生成

2. **位运算** (`packBits`, `unpackBits`)
   - 位域的组装和解析
   - 大整数处理 (BigInt)
   - 位宽约束和掩码

3. **数值转换** (`encodeFromNumber`, `decodeToNumber`)
   - IEEE 754 编码/解码
   - Ties-to-even 舍入
   - 特殊值处理 (NaN, Infinity, subnormal)

4. **UI 渲染** (`renderBlock`, `renderAllFormats`)
   - 动态 DOM 生成
   - 事件绑定
   - 实时更新

### 文件结构
```
floatConverter2/
├── index.html          # 主页面
├── app.js             # 核心 JavaScript 逻辑
├── styles.css         # 样式定义
└── README.md          # 项目文档
```

## 🎨 自定义和扩展

### 添加新的内置格式
```javascript
// 在 FORMATS 数组中添加
{
  key: "custom_format",
  title: "Custom Format",
  sign: 1,    // 符号位数
  exp: 4,     // 指数位数  
  frac: 3,    // 小数位数
  bias: 7,    // 偏移量
  isCustom: false
}
```

### 修改主题颜色
```css
:root {
  /* 位字段配色 */
  --color-sign: #8ea1ff;   /* 符号位 */
  --color-exp: #b4f1b4;    /* 指数位 */
  --color-frac: #ffb8c6;   /* 小数位 */
}
```

### 添加特殊值按钮
```javascript
specials.appendChild(makeBtn("自定义值", () => {
  setFromNumber(yourCustomValue);
}));
```

## 🔧 开发指南

### 代码风格
- 使用 ES6+ 语法
- 驼峰命名法
- 详细的注释
- 模块化设计

### 关键设计原则
1. **数值精度**: 使用 BigInt 处理位操作，避免精度损失
2. **用户体验**: 实时反馈，智能验证，错误处理
3. **可扩展性**: 模块化设计，易于添加新格式
4. **性能优化**: 事件防抖，DOM 复用

### 调试技巧
1. **浏览器控制台**: 查看 `FORMATS` 数组和 `CustomFormatManager`
2. **位域验证**: 使用 `hexFromBits()` 检查位表示
3. **数值验证**: 使用 `decodeToNumber()` 验证解码结果

## 🐛 常见问题

### Q: 为什么无符号格式的最高位显示为绿色？
A: 无符号格式 (如 U0E8M0) 没有符号位，最高位实际上是指数位的一部分，因此显示为绿色。

### Q: 自定义格式的偏移量如何计算？
A: 使用标准公式：`偏移量 = 2^(指数位数-1) - 1`，指数位数为0时偏移量为0。

### Q: 支持的最大位数是多少？
A: 总位数限制在64位以内，单个字段最大32位。

### Q: 如何重置格式到初始值？
A: 使用 Ctrl+R 快捷键或点击 "π" 按钮。

## 📚 参考资料

- [IEEE 754 标准](https://en.wikipedia.org/wiki/IEEE_754)
- [Half-precision 浮点](https://en.wikipedia.org/wiki/Half-precision_floating-point_format)
- [Single-precision 浮点](https://en.wikipedia.org/wiki/Single-precision_floating-point_format)
- [Double-precision 浮点](https://en.wikipedia.org/wiki/Double-precision_floating-point_format)
- [Bfloat16 格式](https://en.wikipedia.org/wiki/Bfloat16_floating-point_format)
- [FP8 格式论文](https://arxiv.org/abs/2209.05433)

## 🤝 贡献指南

欢迎提交 Issues 和 Pull Requests！

1. Fork 项目
2. 创建特性分支
3. 提交更改
4. 推送到分支
5. 创建 Pull Request

## 📄 许可证

本项目采用 MIT 许可证。详见 [LICENSE](LICENSE) 文件。

## 📞 联系方式

如有问题或建议，请通过以下方式联系：

- 提交 Issue
- 发送邮件
- 项目讨论区

---

**享受探索浮点数的乐趣！** 🎉
