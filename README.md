# Sunset Predictor 日落预测器

A lightweight web app to predict **sunset glow (火烧云)**, built with **Astro + React + TailwindCSS**.  
一个基于 **Astro + React + TailwindCSS** 构建的轻量级网页应用，用于预测日落时是否会出现 **火烧云**。  

---

## ✨ Features 功能特性
- **Location selection 地点选择**：支持选择并保存观测地点  
- **Scoring 条件打分**：综合云量、湿度等参数，给出火烧云出现的可能性评分  
- **Visualization 可视化结果**：通过图表直观显示预测结果  
- **Feedback 互动反馈**：用户可在留言板反馈使用体验（Supabase 驱动）  

---

## 🛠 Tech Stack 技术栈
- [Astro](https://astro.build/) — Static site framework / 静态站点框架  
- [React](https://react.dev/) — Component logic / 前端组件逻辑  
- [Tailwind CSS](https://tailwindcss.com/) — Rapid styling / 快速样式开发  
- [Supabase](https://supabase.com/) — Database & feedback board / 数据存储与留言板  
- Deployment 部署：**GitHub Pages / Vercel**  

---

## 🚀 Quick Start 快速开始

1. Clone repo 克隆仓库：
   ```bash
   git clone https://github.com/你的用户名/sunsetPredictor.git
   cd sunsetPredictor
   ```

2. Install dependencies 安装依赖：
   ```bash
   npm install
   ```

3. Run dev server 启动开发服务器：
   ```bash
   npm run dev
   ```

4. Build for production 构建生产版本：
   ```bash
   npm run build
   ```

---

## 🔧 Configuration 配置

- Environment variables 环境变量（可选，用于留言板功能）：
  ```bash
  SITE_URL=http://localhost:4321
  NEXT_PUBLIC_SUPABASE_URL=你的supabase_url
  NEXT_PUBLIC_SUPABASE_ANON_KEY=你的supabase_key
  ```

- Deploy to GitHub Pages 部署到 GitHub Pages → 自动使用 `/sunsetPredictor/` 子路径  
- Deploy to Vercel 部署到 Vercel → 自动使用根路径 `/`  

---

## 🌐 Online Demo 在线预览

- GitHub Pages: [https://escapeResearchZero.github.io/sunsetPredictor/](https://escapeResearchZero.github.io/sunsetPredictor/)  
- Vercel: [https://sunset-predictor.vercel.app/](https://sunset-predictor.vercel.app/)  

---

## 📜 License 许可协议
MIT
