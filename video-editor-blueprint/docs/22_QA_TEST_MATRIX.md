# 22 — Test Stratejisi, Medya Matrisi ve Kabul Kanıtı

> Tarih: 2026-09-19 · Sürüm: 0.1 · Durum: ÖNERİLEN SPESİFİKASYON
> Bu paketteki ürün kararları başlangıç önerisidir; uygulamanın yapılmış veya test edilmiş olduğunu göstermez.

## Test katmanları

Unit: EDL süre/crop/gain ve undo; contract: tüm dillerde aynı JSON; integration: storage/native köprü/queue/provider; media golden: görüntü/ses çıktı; end-to-end: gerçek kaynak→çıktı; manuel usability/accessibility: gerçek insanlar ve cihazlar.

Coverage yardımcı sinyaldir; domain kritik dallarının testlenmesi gerekir. Native decoder, ses sync, satın alma iadesi ve dosya kurtarma yüksek coverage etiketiyle garanti olmaz.

## Fixture envanteri — oluşturulacak, kullanıcı videosu kullanılmayacak

| Kimlik | Girdi / işlem | Beklenen kanıt |
|---|---|---|
| M01 | 20 s dikey H.264/SDR + iki aralık | Çıktı 10 s; doğru sıra ve görüntü |
| M02 | 90° rotation metadata | Dikey görüntü doğru; ikinci kez dönmemiş |
| M03 | Yatay kaynak→9:16 crop | Preview ve çıktı aynı alan |
| M04 | Sesiz video + MP3/WAV müzik | Ses kaynağı doğru, sessiz stream hatası yok |
| M05 | 44.1 kHz müzik +48 kHz kaynak | Drift/pitch değişimi yok |
| M06 | VFR telefon kaydı | PTS sırası, kesim aralıkları ve sync korunuyor |
| M07 | 29.97/59.94 fps kaynak | Yuvarlanan fps yüzünden zaman kaymıyor |
| M08 | Müzik 5–15 s, timeline başlangıcı 2 s | İlk 2 s müzik yok; sonraki offset doğru |
| M09 | Klip sınırında ses darbesi | Beklenmedik çift ses/boşluk yok |
| M10 | 4K/HEVC/HDR kaynağı | Doğrulanmış yol veya erken açık unsupported; yanlış renkli başarı yok |
| M11 | Bozuk/truncated MP4 | Kontrollü hata; app ve proje korunuyor |
| M12 | Çok kısa ve maksimum 20 klip | Minimum aralık ve boundary tutarlı |
| M13 | Büyük dosya/disk dolması | Ön kontrol/hata; yarım çıktı başarı sayılmıyor |
| M14 | Permission revoke/kaynak silinmesi | Re-link yolu; EDL kaybolmuyor |
| M15 | Export'ta app background/kill | Kurtarma; sahte resume iddiası yok |
| M16 | Gain toplamı/fade sınırları | Güvenli miks ve preview/render tutarlılığı |

## Cihaz matrisi

Android düşük/orta/üst sınıftan gerçek cihaz; en eski destek OS + güncel OS. iOS en eski desteklenen OS'yi temsil eden cihaz + güncel iPhone/OS. Web Windows/macOS üzerinde Chrome, Edge, Safari, Firefox için mümkün kombinasyonlar. Fiziksel cihaz eksikse `NOT_RUN` yazılır; emulator sonucu cihaz sonucu yerine geçmez.

Her kayıt: model/OS/browser tam sürümü, RAM, codec bilgisi, app commit/build, fixture SHA, recipe version, warm/cold run, input/output boyutu, süre, peak memory, çıktı kanıtı. P0 sonunda destek matrisi bu kayıtlarla oluşturulur.

## Sayısal kabul hedefleri — ölçülmemiş ürün önerisi

Çıktı süresi beklenen EDL süresinden en çok bir çıktı karesi kadar sapmalı; keyframe hassasiyetiyle kaydırılan saniyeler kabul edilmez. Audio/video senkronu referans darbeli testlerde hedef ≤40 ms. Crop kenar farkı çıkış ölçeğinde hedef ≤2 piksel; encoder yüzünden byte farkı normaldir. Mux timestamp monotonluğu ve decode edilebilirlik zorunludur.

Bellek/hız için bütün cihazlara tek sayıyla vaat yok. P0'da p50/p95 süre ve peak memory kaydedilir; güvenli destek sınırı bunlardan seçilir. Her performans karşılaştırması aynı dosya, aynı iş, aynı donanım koşulunda yapılır. Üretim “gerçek zamanlı” iddiası ölçüm olmadan yasaktır.

## Kota ve ödeme regresyonları

1. Aynı receipt iki canonical hesapta kullanılmak istenir: kontrol edilen çatışma, çift grant yok.
2. Duplicate/sırasız webhook: tek hak güncellemesi, yeni yenileme eski event'le silinmez.
3. 42 s job için iki eşzamanlı istek: transaction sınırları korunur.
4. Job success callback iki kez: yalnızca bir debit; cancel sonrası success yarışı deterministik.
5. Yıllık plan 31 Ocak: Şubat clamp, Mart anchor'a dönüş; 12 aylık hak peşin verilmez.
6. Renewal canceled fakat paidThrough gelecekte: hak korunur.
7. Refund/revoke: cloud hemen server'da kapanır; kısa offline cache riski belgeli.
8. Provider outage: media dosyası kaybolmaz, client bool'u cloud hakkı açmaz.
9. Sandbox transaction: production quota vermez.
10. Dönem sınırında aktif reservation: aynı job iki ayı harcamaz.

## Erişilebilirlik ve UX

TalkBack/VoiceOver ile klip ekle/sırala/sil, fare olmadan crop alternatifi, metin %200 büyüme, düşük kontrast/renk ayırımı, reduced motion, yanlış dosya ve boş proje, “şimdi değil” paywall dönüşü. Gerçek çıktı alamayan oturum başarılı onboarding olarak işaretlenmez.

## Release kapısı

Bütün P0 kritik fixture'ları geçmeli; veri kaybı/yetkisiz erişim/çift charge açık hatası olmamalı. Destek matrisi dışındakiler UI'da sınırlandırılmalı. Bilinen sorunlar release notes'ta gerçek etkisiyle yazılmalı. Test sonuç raporunda `PASS`, `FAIL`, `NOT_RUN`, `BLOCKED` ayrımı kullanılır.

Bu belge testlerin çalıştırıldığı anlamına gelmez. İlk kodlama raporunun özellikle çalıştırılamayan native ve fiziksel cihaz kontrollerini belirtmesi gerekir.
