# 发布模式

当前项目已明确选择“内部自用版”作为交付模式。公开 CA 签名不再作为必须项，也不影响软件功能、安装、备份或更新。

## 公开版

公开版适合发给未知用户下载，要求 Windows 可信任的 CA 代码签名证书。

- 证书需要付费购买或使用付费云签名服务，没有免费替代。
- 发布流程：配置 GitHub Secrets 的 `CSC_LINK` 和 `CSC_KEY_PASSWORD`，然后打 `v2-*` tag。
- `.github/workflows/v2-release.yml` 会在发布前执行 `verify:signature`，自签名证书会被拒绝。

## 内部自用版

内部自用版免费，适合自己诊所或受控电脑安装，不要求 CA 证书。

```powershell
cd D:\Desktop\rongyi
pnpm --filter @dental/v2 electron:dist:internal
```

该命令会：

1. 在临时目录生成一张自签名代码签名证书。
2. 构建 Web、API 和 Electron 安装包。
3. 以 `<package.json版本>-internal.<UTC时间戳>` 作为内部版本号打包（保证每次内部构建严格递增，内部 feed 的更新才会被 electron-updater 识别并应用；打包完成后还原 `package.json`）。
4. 校验安装包、`latest.yml` 和 blockmap。
5. 运行 NSIS 安装/卸载 smoke。

产物位于 `apps/v2/release-v2/`。因为证书不受 Windows 信任，首次运行会显示“未知发布者”，需要选择“更多信息”后“仍要运行”。这只应在你控制的电脑上使用，不适合作为公开软件分发。

如果希望把内部版放到 GitHub Release 上，方便多台受控电脑下载，可以在 GitHub Actions 页面手动运行 `V2 Internal Release` workflow：

1. 输入 `version`，例如 `2.2.0`。
2. 保持 `run_installer_smoke` 为 `true`。
3. 运行后会在 `v2-internal-<完整内部版本>` tag（如 `v2-internal-2.2.0-internal.20260811120000`）下生成安装包、blockmap 和 `latest.yml`，每个内部构建使用独立 tag，避免覆盖同基线版本。

该 workflow 不需要 CA 证书或付费签名服务，但发布的是自签名内部版，Windows 仍会显示未知发布者。

当前已验证的内部 Release：

[v2-internal-2.2.0](https://github.com/1290464284-ship-it/rongyi/releases/tag/v2-internal-2.2.0)

如果 `electron-builder` 从 GitHub 下载 Electron/签名工具超时，可先设置国内镜像再执行：

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
pnpm --filter @dental/v2 electron:dist:internal
```

### 内部签名证书管理（certs/internal-signing.pfx）

内部版更新链的信任根是一张自签名代码签名证书（`create-internal-signing-cert.ps1`
默认 5 年有效期）。全部资产**不入库**（根 `.gitignore` 的 `certs/` 与
`apps/v2/.gitignore` 的 `build/internal-signing.pfx.cer` 生效）：

| 资产 | 路径 | 性质 |
|---|---|---|
| 私钥+证书（PFX） | `certs/internal-signing.pfx` | 密钥，仅签名机持有 |
| 密码 | `certs/internal-signing.pfx-password.txt` | 密钥，与 PFX 同机保管 |
| 公钥 CER | `certs/internal-signing.pfx.cer`；签名时复制为 `apps/v2/build/internal-signing.pfx.cer` | 随安装包分发（asarUnpack） |

流转链路：

1. 首次生成：`powershell -ExecutionPolicy Bypass -File apps/v2/scripts/create-internal-signing-cert.ps1`
   （`build-internal-installer.ps1` 检测缺失时也会自动生成）。
2. `electron:dist:internal` 用 PFX 签名安装包与更新包，并把 CER 打进
   `app.asar.unpacked/build/internal-signing.pfx.cer`。
3. 受控机首次启动时 `electron/cert-trust.cjs` 把 CER 导入 CurrentUser 的
   Root + TrustedPublisher（可用 `V2_EXPECTED_INTERNAL_CERT_THUMBPRINT` 做
   指纹校验）；`deploy-fleet.ps1`（无人值守）与 `install-internal-cert.ps1`
   （手动）可提前导入。
4. `electron-updater` 的 `verifyUpdateCodeSignature: true` 以该信任根验证
   每个内部更新的 Authenticode 签名（`cert-trust-smoke.ps1` 全程离线校验
   这条链）。

轮换/丢失的后果（必须知晓）：

- **丢失 PFX 或密码**：无法再对内部版签名。重新生成证书后，已装机的信任根
  仍是旧证书，**旧机器会拒绝所有新签名的更新**；需用
  `install-internal-cert.ps1`（手动）或 `deploy-fleet.ps1`（无人值守）把新
  CER 重新导入每台受控机。
- **备份要求**：PFX 与密码至少双份离线备份，与数据备份同级别对待；至少一名
  备份持有人（见《运维交接手册》）。
- **到期（默认 5 年）**：到期前完成轮换并同步重灌 CER，否则更新链中断。


## 不花钱的边界

- 自签名证书：免费，适合内部受控分发，Windows 会提示未知发布者。
- GitHub Releases 和 CI：免费额度内可上传安装包和更新元数据。
- CA 签发证书：没有免费公开渠道，费用通常是每年几百到几千元，或使用 Azure Trusted Signing 等云签名服务的月费方案。
- 如果目标是“陌生人下载后没有 SmartScreen 警告”，这个需求无法在不花钱的前提下满足。
