param(
  [string]$Output = (Join-Path $PSScriptRoot 'DeskPanel.ico')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$images = New-Object System.Collections.ArrayList

foreach ($size in $sizes) {
  $bitmap = New-Object System.Drawing.Bitmap($size, $size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.Color]::Transparent)

    $inset = [Math]::Max(1, [int]($size * 0.03))
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(13, 148, 136))
    try {
      $graphics.FillEllipse($brush, $inset, $inset, $size - $inset * 2, $size - $inset * 2)
    } finally {
      $brush.Dispose()
    }

    $fontSize = [Math]::Max(8, [float]($size * 0.6))
    $font = New-Object System.Drawing.Font('Segoe UI', $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $format = New-Object System.Drawing.StringFormat
    try {
      $format.Alignment = [System.Drawing.StringAlignment]::Center
      $format.LineAlignment = [System.Drawing.StringAlignment]::Center
      $rect = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
      $graphics.DrawString('D', $font, [System.Drawing.Brushes]::White, $rect, $format)
    } finally {
      $format.Dispose()
      $font.Dispose()
    }

    $stream = New-Object System.IO.MemoryStream
    try {
      $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
      [void]$images.Add($stream.ToArray())
    } finally {
      $stream.Dispose()
    }
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

$outputStream = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter($outputStream)
try {
  $writer.Write([UInt16]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]$sizes.Count)

  $offset = 6 + 16 * $sizes.Count
  for ($i = 0; $i -lt $sizes.Count; $i++) {
    $size = $sizes[$i]
    $data = $images[$i]
    $writer.Write([byte]$(if ($size -ge 256) { 0 } else { $size }))
    $writer.Write([byte]$(if ($size -ge 256) { 0 } else { $size }))
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]32)
    $writer.Write([UInt32]$data.Length)
    $writer.Write([UInt32]$offset)
    $offset += $data.Length
  }

  foreach ($data in $images) {
    $writer.Write($data)
  }

  $writer.Flush()
  [System.IO.File]::WriteAllBytes($Output, $outputStream.ToArray())
} finally {
  $writer.Dispose()
  $outputStream.Dispose()
}

Write-Host "Icon: $Output"
