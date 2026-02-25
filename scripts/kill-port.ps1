# 终止占用指定端口的进程
param(
    [int]$Port = 5173
)

Write-Host "正在查找占用端口 $Port 的进程..." -ForegroundColor Yellow

$connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue

if ($connections) {
    $processIds = $connections | Select-Object -ExpandProperty OwningProcess -Unique
    
    foreach ($pid in $processIds) {
        $process = Get-Process -Id $pid -ErrorAction SilentlyContinue
        if ($process) {
            Write-Host "找到进程: $($process.ProcessName) (PID: $pid)" -ForegroundColor Red
            Write-Host "路径: $($process.Path)" -ForegroundColor Gray
            
            # 终止进程
            try {
                Stop-Process -Id $pid -Force
                Write-Host "✓ 已终止进程 PID: $pid" -ForegroundColor Green
            } catch {
                Write-Host "✗ 无法终止进程 PID: $pid - $($_.Exception.Message)" -ForegroundColor Red
            }
        }
    }
} else {
    Write-Host "端口 $Port 未被占用" -ForegroundColor Green
}

Write-Host "`n完成！" -ForegroundColor Cyan
