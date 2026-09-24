# ADR-027 — Hızlı kesim: kaynağın sıkıştırılmış kareleri kopyalanır, yalnızca kesim noktaları kodlanır

> Tarih: 2026-09-23 · Durum: UYGULANDI ve ÖLÇÜLDÜ (tek makine: Windows 11, RTX 3070 Ti;
> Chrome, Edge, Playwright Chromium). Ölçüm belgesi:
> [`docs/spikes/2026-09-23-fast-cut.md`](../spikes/2026-09-23-fast-cut.md).

## Bağlam

Her indirme bugüne kadar her kareyi yeniden kodluyordu (çöz → tuval → H.264).
60 dakikalık 1080p çıktı Chrome'da ~7,5 dakika (×7,9 gerçek zaman), Chromium'da
~17 dakika sürüyor (ADR-020). Kurucunun ana kullanımı uzun videodan aralık
("kesit") alıp indirmek; çoğu zaman kırpma, altyazı ya da müzik yok.

Kurucu kararı (23 Eylül 2026): **kare hassas.** Kesit tam işaretlenen karede
başlayıp bitmeli. Mümkünse yalnızca kesim noktalarının çevresi yeniden kodlanır
("smart cut"), gerisi olduğu gibi kopyalanır; mümkün değilse bugünkü tam kodlama
çalışır ve arayüz hangisinin olduğunu söyler.

## Karar

(ölçüm tamamlanınca doldurulacak)
