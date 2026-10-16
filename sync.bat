@echo off
rem 盯盯车面板：同步数据并推送到 GitHub
rem 用法：sync.bat        只同步
rem       sync.bat push   同步后提交并推送 docs/data
chcp 65001 >nul
cd /d "%~dp0"

echo [1/3] 同步 SurCam 数据（只读 GET）...
node sync.js
if errorlevel 1 (
  echo.
  echo 同步失败。若是 token 过期，请先运行 ..\autosign\refresh_token.bat 刷新后再试。
  pause
  exit /b 1
)

if /i "%1"=="push" (
  echo [2/3] 提交数据变更...
  git add docs\data
  git diff --cached --quiet docs\data
  if errorlevel 1 (
    git commit -m "data: sync %date% %time%"
    echo [3/3] 推送...
    git push
  ) else (
    echo [2/3] 数据无变化，跳过提交
  )
) else (
  echo [2/3] 未指定 push，跳过 git 提交
)
echo 完成。
