# Beta için ücretsiz yayın rehberi

> Tarih: 2026-09-22 · Durum: HAZIRLIK — **yayın yapılmadı.** Herkese açık bir adres
> dışa dönük bir eylemdir; kurucu onayı ve isim/iletişim kararı (belge 30 K01) gerekir.

## Teknik şartlar (kodda doğrulandı)

- Bütün sayfalar statik (`next build` çıktısı: `/`, `/editor` ○ Static). Sunucu kodu,
  veritabanı, API anahtarı yok.
- **HTTPS zorunlu.** WebCodecs, OPFS ve Web Worker'daki senkron dosya erişimi yalnızca
  güvenli bağlamda çalışır. `http://192.168…` gibi yerel ağ adresleri güvenli sayılmaz:
  sayfa açılır ama dışa aktarma kapısı reddeder. Telefon testi bu yüzden yayın ister.
- Cross-origin izolasyon (COOP/COEP) **gerekmez**; `SharedArrayBuffer` kullanılmıyor.
- Dış kaynak yok: font dosyaları uygulamayla birlikte sunuluyor (`/fonts/caption/`),
  üçüncü taraf betik, analitik ya da CDN yok.

## Ücretsiz seçenekler

| Seçenek | Nasıl | Artı | Eksi |
|---|---|---|---|
| **Cloudflare Pages** (ücretsiz katman) | GitHub deposunu bağla; build `npm run build`, kök `web/` | Sınırsız bant genişliği, HTTPS, önizleme adresleri | Next için adaptör ya da statik dışa aktarma gerekir |
| **Vercel Hobby** | GitHub deposunu bağla; kök `web/` | Next'i doğrudan tanır, sıfır ayar | Hobby planı ticari kullanım için değil; beta sonrası gözden geçirilmeli |
| **GitHub Pages** | `output: 'export'` ile tamamen statik çıktı, Actions ile yayın | Depo zaten herkese açık; ek hesap yok | Alt dizin yolu (`/capcut/`) için `basePath` ayarı gerekir; test edilmedi |

Önerim: **GitHub Pages** — ek hesap açmadan, depoyla aynı yerde, ücretsiz. Gereken kod
değişikliği küçük (`output: 'export'`, `basePath`) ama henüz yapılmadı ve test edilmedi.

## Yayından önce kontrol

1. `npm run typecheck && npm run lint && npm test && npm run build && npm run test:e2e`
2. Dosya matrisi: `npm run matrix:media && npm run matrix -- --browser=chrome`
3. Yayınlanan adreste: bir video aç, iki an ekle, dışa aktar, indir; "Sorun bildir" ile
   tanı dosyasını indir ve içinde dosya adı olmadığını kontrol et.
4. Gizlilik sayfasındaki "belirlenmedi" alanları kurucu kararıyla doldurulmadan sayfa
   "taslak" etiketiyle kalır.
