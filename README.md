# Agentic Sniper

AgenticMint üzerindeki güncel ücretsiz NFT mintlerini tarayan BSC botu. Bir koleksiyona veya bir Agent ID'ye bağlı değildir. Her kullanıcı kendi bilgisayarındaki resmi Binance Agentic Wallet (`baw`) oturumuyla bağlanır.

Node.js **22.16+**, Windows / macOS / Linux. İşletim sistemine özel cüzdan anahtarı veya DPAPI kodu içermez. BAW oturumunu CLI yönetir; bot özel anahtar istemez.

## Kurulum

Önce Node.js ve resmi Binance Agentic Wallet CLI kurulu olmalı; `baw --version` çalışmalı. CLI için resmi kaynak: https://github.com/binance/agentic-wallet

```sh
git clone https://github.com/khenzarr/agentic-sniper.git
cd agentic-sniper
npm ci
npm run browser:install
npm test
```

Windows PowerShell:
```powershell
Copy-Item .env.example .env
```

macOS / Linux:
```sh
cp .env.example .env
```

Mevcut kurulumu güncelliyorsanız **.env dosyanızı ezmeyin**. Etherscan V2 anahtarınızı `ETHERSCAN_API_KEY` alanına ekleyin. Kaynak API hataları ayrı raporlanır: `API_KEY_INVALID`, `API_RATE_LIMIT`, `SOURCE_UNVERIFIED`. Geçici hatalar sınırlı geri çekilmeyle tekrar denenir.

## Kendi cüzdanınla giriş

```sh
npm run login
```

Çıktıdaki giriş bağlantısını kendi bilgisayarınızda açıp Binance üzerinden onaylayın. Gerekirse dönen QR kimliğiyle tamamlayın:

```sh
npm run login -- --qr QR_CODE_ID
npm run doctor
```

Giriş bağlantısı/QR verilerini paylaşmayın. Oturum süresi dolarsa aynı giriş akışını tekrar kullanın. Botta khenzar.ai kısıtı yoktur; bağlı cüzdanın sahip olduğu Agent ID okunur. Hesap değiştirmek için mevcut botu durdurun ve `baw auth signout` sonrasında yeni hesapla giriş yapın.

## İlk çalıştırma

```sh
npm run scan
npm run audit
npm run sniper:once
npm run sniper:watch
```

- `scan`: cüzdan gerektirmeden güncel radar listesini okur.
- `audit`: bağlı cüzdan için kaynak/ABI, NFT arayüzü, sıfır bedelli çağrı ve gas simülasyonu yapar. BAW önizlemesi oluşturmaz.
- `sniper:once`: bir tarama döngüsü.
- `sniper:watch`: yapılandırılan aralıkla sürekli çalışır. Terminal açık kalmalı; Ctrl+C durdurur.
- Varsayılan **preview** modunda hiçbir işlem gönderilmez.

## Çalışma modları

| SNIPER_MODE | Davranış |
| --- | --- |
| `preview` | Uygun adaylar için BAW önizlemesi üretir; execute çağırmaz. |
| `app` | Yalnız BAW'ın uygulama onayı gerektirdiği önizlemeleri execute eder; Binance uygulamasında onay bekler. |
| `auto` | Kontrolleri geçen önizlemeleri otomatik execute eder. BAW uygulama onayı isterse yine kullanıcı onayı gerekir. |

**Gerçek gönderimi etkinleştirmek** için iki ayar da gereklidir:

`config.json` içinde:
```json
"executionEnabled": true
```

`.env` içinde:
```ini
SNIPER_MODE=auto
ENABLE_EXECUTE=YES_I_UNDERSTAND
```

Ardından `npm run doctor` ile etkin modu doğrulayın ve `npm run sniper:watch` çalıştırın. Eski `SNIPER_APP_APPROVAL_REQUESTS` değişkeni artık kullanılmaz. Binance'in zorunlu onayı veya Developer Mode/oturum süresi bot tarafından aşılmaz. Dağıtılan ayarlar ve bu projedeki canlı testler preview modundadır.

## Aday seçimi

1. Güncel radar tablosundaki ücretsiz ERC-721/ERC-1155 adaylarını alır; sitedeki komutları çalıştırmaz.
2. BSC bytecode ve NFT arayüzünü doğrular.
3. Etherscan üzerinden doğrulanmış kaynak ve ABI ister; proxy kontratları otomatik kabul etmez.
4. `mint`, `publicMint`, `freeMint`, `claim` adlarını değerlendirir.
5. Parametresiz fonksiyonlar veya anlamı açık recipient/quantity parametrelerini destekler. Recipient bağlı cüzdandır, quantity 1'dir. Belirsiz tokenId, proof veya signature parametreleri tahmin edilmez.
6. `payable` fonksiyon da **value=0** ile simüle edilebilir. Ücretli aşama, sold-out veya uygunluk engeli revert ederse gönderilmez.
7. Birden fazla yöntem başarılıysa seçim yapmaz; `AMBIGUOUS_MINT_METHODS` raporlar.
8. Gas, bakiye, BAW simülasyonu ve risk kontrollerini uygular. Approval/authority değişiklikleri veya risk sinyalleri engeldir.
9. BAW balanceChanges içinde yalnızca hedef koleksiyondan bağlı cüzdana gelen **bir NFT** kabul edilir. ERC-20, giden varlık, başka alıcı/koleksiyon, birden fazla değişim veya bilinmeyen şema engellenir. Dolayısıyla her public free mint otomatik desteklenmez.

Kaynak doğrulaması güvenlik denetimi değildir. Radarın “FREE” etiketi tek başına mint hakkı kanıtlamaz. Ücretsiz mintte de ağ ücreti ödenir.

## Limitler, geçmiş ve tekrar başlatma

`config.json`: günlük varsayılan 5 gönderim, işlem başına 0.0001 BNB **tahmini** gas bütçesi, 120 saniye tarama aralığı (en az 90 saniye). Gas birimi ve fiyatı ayrı ayrı %20 artırılarak kontrol edilir; BAW üzerinden mutlak ücret tavanı garanti edilmez.

Kayıtlar `state/56/<wallet>/` altında cüzdan bazındadır. Her cüzdan için dosya kilidi eşzamanlı ikinci çalıştırmayı engeller. Bir kontrat için gönderim kaydı varsa aynı cüzdan tekrar denemez; başarısız işlemler de günlük limite dahildir. Preview modunda ilk adayda durmaz, bütün uygun koleksiyonları işler.

İşlem gönderilmeden önce kayıt diske yazılır. Sonraki döngüde:
- Pending işlemler cüzdan geçmişindeki **aynı orderId** üzerinden tx hash ile eşleştirilir.
- Hash varsa üç onay sonrasında receipt, gönderen, hedef, calldata, sıfır value ve NFT mint olayı doğrulanır.
- Başarılı mintten sonra sonraki koleksiyona geçilir.
- Timeout/belirsiz sonuçta otomatik tekrar gönderim yapılmaz.
- Eşleşen mint olayı yoksa `NEEDS_REVIEW` olur; otomatik devam edilmez.

```sh
npm run history
npm run reconcile
```

Bilinmeyen gönderimin hash'ini Binance geçmişinde bulduysanız:
```sh
node src/hunter.mjs attach --id RECORD_ID --tx 0xTRANSACTION_HASH
npm run reconcile
```

Hash, kayıtla eşleşen zincir işlemi doğrulanmadan eklenmez. OrderId/hash bulunamıyorsa kayıtları silip tekrar göndermeyin; önce cüzdan geçmişini inceleyin. Kilit dosyası çökme sonrası kalırsa çalışan başka bot olmadığını doğrulamadan kaldırmayın.

Eski sürümün kök `state/history.json` dosyasında işlem varsa yeni sürüm bunu otomatik aktarmaz; başlamadan önce geçmişi kontrol edin. Eski dosyalar silinmez. Her kullanıcı ayrı işletim sistemi hesabı/kurulum kullanmalıdır; bu bir ortak sunucuda çok kiracılı cüzdan servisi değildir.

## Doğrulama

`npm test` gerçek cüzdan işlemi yapmaz. Motor testleri timeout, tekrar gönderim, cüzdan ayrımı, cüzdan değiştirme, süre aşımı, günlük limit, kaynak API hataları, belirsiz yöntemler ve receipt sonrası devamı kapsar. GitHub Actions Node 22/24 ile Windows, macOS ve Linux üzerinde çalışır.

Canlı NFT minti test amacıyla otomatik gönderilmez. Desteklenmeyen kontratlar/BAW yanıtları açık bir gerekçeyle atlanır. Anahtarlar, .env, yerel geçmiş ve cüzdan oturumları Git'e dahil edilmez.
