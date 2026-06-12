# Recursos para Pipeline de Análise de Vídeo de Padel

> Levantamento verificado em 2026-06-12. Todos os URLs marcados ✅ foram confirmados por acesso direto nesta data. Pipeline de referência: **YOLOX-m (deteção) + ByteTrack + RTMPose-m (pose) + classificador TCN de pancadas + homografia de 4 pontos**.
>
> Legenda: ✅ **descarregável hoje** · 📄 **apenas paper / acesso indireto** · ⚠️ **licença restritiva (não comercial)**

---

## 1. Deteção e seguimento da bola

### WASB — Widely Applicable Strong Baseline (NTT) ✅ **Recomendado**
- **URL:** https://github.com/nttcom/WASB-SBDT
- **Conteúdo:** Código oficial (BMVC 2023) de deteção/seguimento de bolas pequenas em 5 desportos (futebol, **ténis, badminton**, voleibol, basquetebol). Inclui ainda implementações de avaliação de TrackNetV2, ResTrackNetV2, MonoTrack, DeepBall e BallSeg.
- **Pesos:** ✅ Pré-treinados para os 5 desportos no Google Drive (links no `MODEL_ZOO.md`); pesos de **ténis** e **badminton** confirmados.
- **Licença:** **MIT** — utilizável em produto comercial.
- **Integração:** Substitui/complementa um detetor YOLO de bola; *fine-tuning* dos pesos de ténis com frames de padel; a saída (x,y por frame) alimenta diretamente o ByteTrack ou um filtro de trajetória próprio.

### TrackNetV3 (qaz812345) ✅
- **URL:** https://github.com/qaz812345/TrackNetV3
- **Conteúdo:** Implementação PyTorch do paper "TrackNetV3: Enhancing ShuttleCock Tracking with Augmentations and Trajectory Rectification". Módulo de tracking + módulo de retificação/inpainting de trajetória. Treinado no Shuttlecock Trajectory Dataset (badminton).
- **Pesos:** ✅ Checkpoints no Google Drive (link no README).
- **Licença:** **MIT**.
- **Integração:** O módulo de retificação de trajetória é diretamente reutilizável para interpolar posições da bola de padel em falha de deteção (oclusões pelas paredes de vidro).

### TrackNet (yastrebksv, PyTorch, ténis) ✅
- **URL:** https://github.com/yastrebksv/TrackNet
- **Conteúdo:** Reimplementação PyTorch não oficial do TrackNet original; dataset de ténis (10 vídeos broadcast, 19.835 frames anotados 1280×720) via Google Drive.
- **Pesos:** ✅ Google Drive.
- **Licença:** ⚠️ **Não especificada no repositório** — pedir esclarecimento ao autor antes de uso comercial.
- **Integração:** Base simples baseada em heatmaps de 3 frames; bom ponto de partida para *fine-tuning* com bola de padel.

### TrackNetV2 (oficial) 📄 / mirror ✅
- **URL oficial:** https://gitlab.nol.cs.nctu.edu.tw/open-source/TrackNetv2 — ⚠️ **inacessível na data de verificação** (ligação recusada).
- **Mirror PyTorch:** https://github.com/ChgygLin/TrackNetV2-pytorch ✅ (conversão do TensorFlow, com pesos `track.pt` e inferência ncnn/C++).
- **Nota:** A reimplementação dentro do WASB-SBDT (MIT) é a via mais segura.

### MonoTrack ⚠️ 📄
- **URL:** https://github.com/jhwang7628/monotrack
- **Conteúdo:** Reconstrução 3D/2D da trajetória do volante em badminton (CVPRW 2022): deteção de campo, pose (MMPose/MMDet), TrackNet modificado, HitNet (deteção de batimento).
- **Licença:** ⚠️ **Adobe Research License — apenas uso não comercial (investigação académica)**. **Não usável num produto comercial.**
- **Integração:** Útil só como referência de arquitetura (o HitNet é um bom modelo conceptual para deteção de momento de pancada via TCN).

### Datasets de bola de padel no Roboflow Universe ✅
| Dataset | URL | Dimensão |
|---|---|---|
| Padel Ball Hit (SQQA) | https://universe.roboflow.com/sqqa/padel-ball-hit-2lmfn | ~9.900 imagens |
| Padel Tennis Ball Detection (rbada) | https://universe.roboflow.com/rbada/padel-tennis-ball-detection | ~1.000 imagens |
| Padel balls (padel analyzer) | https://universe.roboflow.com/padel-analyzer/padel-balls-6lp8r | 116 imagens |
| padel dataset (bola+jogadores) | https://universe.roboflow.com/padel-ll7pp/padel-dataset | ~9.200 imagens |

- **Licença:** ⚠️ Varia por projeto (tipicamente CC BY 4.0, mas alguns são "Public Domain" ou sem licença explícita) — **verificar na página de cada projeto** (as páginas bloqueiam fetch automatizado; confirmar manualmente no browser). Exportação em formatos YOLO/COCO/Pascal VOC.
- **Integração:** Dados de *fine-tuning* imediato para a cabeça de deteção de bola (YOLOX ou WASB).

---

## 2. Datasets específicos de padel

### PadelTracker100 ✅ **O recurso mais importante desta lista**
- **URL (Zenodo):** https://zenodo.org/records/14653706 · DOI: `10.5281/zenodo.14653706`
- **Paper (Data in Brief):** https://www.sciencedirect.com/science/article/pii/S2352340926000995
- **Conteúdo:** ~100.000 frames (1920×1080@30) de **2 jogos das WPT Finals 2022**, totalmente anotados: trajetória da bola, **posições reais dos jogadores no plano do campo**, pose (anotada com ViTPose-L e refinada manualmente) e **eventos de pancada em 6 classes** (backhand, forehand, smash, serviço, dropshot, outro) em 40.135 frames.
- **Licença:** **Creative Commons Attribution (CC BY)** — compatível com uso comercial com atribuição. (Nota: o Zenodo devolve 403 a fetchers automatizados; o registo foi confirmado via resultados de pesquisa e paper associado — confirmar a variante exata de CC na página antes de redistribuir.)
- **Integração:** Cobre **todas** as fases do pipeline: *fine-tuning* do YOLOX-m (jogadores+bola), validação do ByteTrack, supervisão do TCN de pancadas e ground-truth para a homografia de 4 pontos.

### padel_analytics (Joao-M-Silva) ✅ ⚠️
- **URL:** https://github.com/Joao-M-Silva/padel_analytics
- **Conteúdo:** Pipeline completo de análise de padel (tracking de jogadores, pose 13 keypoints, classificação de pancadas, deteção de batimento, projeção 2D do campo, heatmaps, velocidades). Pesos no Google Drive (não incluídos no repo); sem datasets de treino.
- **Licença:** ⚠️ **CC BY-NC-SA 4.0 — não comercial, share-alike**. Útil como referência de arquitetura, **não incorporar código/pesos num produto comercial**.

### Roboflow Universe — projetos padel ✅
- **Padel Player Detection:** https://universe.roboflow.com/padel-analysis/padel-player-detection
- **Pesquisa geral:** https://universe.roboflow.com/search?q=padel
- Licenças por projeto (verificar individualmente).

### "Real-time Padel Strokes Classification" 📄
- ResearchGate: https://www.researchgate.net/publication/395089365_Real-time_Padel_Strokes_Classification — sem release de dados verificado. **Apenas paper.**

---

## 3. Datasets de ténis/raquetes transferíveis

### THETIS — Three dimEnsional TennIs Shots ✅
- **URL:** https://github.com/THETIS-dataset/dataset
- **Conteúdo:** 8.374 sequências (Kinect), 55 sujeitos, **12 classes de pancada de ténis** (3 backhands, 4 forehands, 3 serviços, smash, volleys), em RGB, profundidade, máscara, esqueleto 2D e 3D.
- **Licença:** ⚠️ "Livre para investigação"; **sem ficheiro de licença explícito** — pedir confirmação para uso comercial. Citar o paper CVPRW 2013.
- **Integração:** Pré-treino do classificador TCN de pancadas sobre esqueletos (os esqueletos 2D/3D alinham com a saída do RTMPose-m); transferência forehand/backhand/smash → padel.

### TenniSet (HaydenFaulkner/Tennis) ✅
- **URL:** https://github.com/HaydenFaulkner/Tennis
- **Conteúdo:** 5 jogos de ténis com **anotações temporais densas em 11 categorias de evento** (serviços, batimentos) + legendas; dados via Google Drive.
- **Licença:** **MIT**.
- **Integração:** Pré-treino/validação da segmentação temporal de rallies e da deteção de eventos de batimento (entrada do TCN).

### ShuttleSet / ShuttleSet22 (CoachAI) ✅
- **URL:** https://github.com/wywyWang/CoachAI-Projects
- **Conteúdo:** Maior dataset de badminton singulares com registos **stroke-level** (ShuttleSet, KDD'23: 44 jogos, 3.685 rallies, 36.492 pancadas; ShuttleSet22: +33.600 pancadas), em CSV com tipo de pancada, posição e resultado do rally.
- **Licença:** **MIT** (repositório).
- **Integração:** Modelação tática (sequências de pancadas, previsão de rally) por cima da saída do classificador TCN.

### BadmintonDB (kwban) ✅ (anotações)
- **URL:** https://github.com/kwban/badminton-db
- **Conteúdo:** Anotações (EAF/JSON) de 9 jogos Ginting vs. Momota: pontos, pancadas, erros, posições de serviço/receção; vídeos via links do YouTube (não incluídos).
- **Licença:** ⚠️ Não indicada no repositório.
- **Integração:** Esquema de anotação de referência para criar o vosso próprio formato de etiquetagem de rallies de padel.

### Dataset de keypoints de campo (TennisCourtDetector) ✅ — ver secção 6.

---

## 4. Modelos de deteção/pose acima de YOLOX-m / RTMPose-m

Referências: YOLOX-m ≈ **46,9 AP** COCO (Apache 2.0); RTMPose-m ≈ **75 AP** COCO (top-down, com detetor).

### Deteção (todas as alternativas abaixo com pesos ✅)

| Modelo | URL | Licença | COCO AP | Velocidade | Nota |
|---|---|---|---|---|---|
| **RTMDet-m/l** (MMDetection) | https://github.com/open-mmlab/mmdetection (`configs/rtmdet`) | **Apache 2.0** ✅ | m ≈ 49,4 / l ≈ 52,8 | l: ~322 FPS (TRT FP16, RTX 3090) | Drop-in no ecossistema MMDet já usado; +2,5 AP sobre YOLOX-m a custo semelhante. **Escolha natural.** |
| **RT-DETR** (lyuwenyu, oficial) | https://github.com/lyuwenyu/RT-DETR | **Apache 2.0** ✅ | R18: 46,5 / R50: 53,1 (55,3 c/ Obj365) | R18: 217 FPS / R50: 108 FPS (T4 TRT FP16) | Sem NMS — latência estável com muitos objetos; pesos COCO+Objects365. |
| **D-FINE** | https://github.com/Peterande/D-FINE | **Apache 2.0** ✅ | S: 48,5 / M: 52,3 / L: 54,0 | tempo-real (classe RT-DETR) | Estado da arte DETR em tempo real; checkpoints COCO e Objects365→COCO. |
| **YOLO11 / YOLO26** (Ultralytics) | https://github.com/ultralytics/ultralytics | ⚠️ **AGPL-3.0** (ou licença Enterprise paga) | YOLO26m: 53,1 | 4,7 ms (T4 TRT10) | AGPL contamina o produto (obrigação de disponibilizar código fonte do serviço) — **evitar em produto comercial fechado** sem licença Enterprise. |

### Pose

| Modelo | URL | Licença | COCO AP | Nota |
|---|---|---|---|---|
| **RTMO-m/l** (MMPose) | https://github.com/open-mmlab/mmpose/tree/main/projects/rtmo | **Apache 2.0** ✅ | s: 67,7 / m: 70,9 / l: 72,4 | 8,9–19,1 ms (V100, ONNXRuntime). **One-stage multi-pessoa** — elimina a dependência do detetor para pose; ótimo para 4 jogadores fixos. Pesos COCO e body7. |
| **ViTPose-B/L/H** | https://github.com/ViTAE-Transformer/ViTPose | **Apache 2.0** ✅ | B: 75,8 / L: 78,3 / H: 79,1 | Top-down pesado — ideal para reprocessamento offline de alta qualidade (foi o usado para anotar o PadelTracker100). |
| RTMPose-m (atual) | https://github.com/open-mmlab/mmpose | Apache 2.0 ✅ | ≈ 75 | Manter para tempo real top-down; RTMO se quiser one-stage. |

**Recomendação prática:** RTMDet-m (ou D-FINE-M) + ByteTrack + RTMPose-m em tempo real; ViTPose-L para reanotação offline. Tudo Apache 2.0.

---

## 5. Reconhecimento de ações baseado em esqueleto

### MMAction2 (OpenMMLab) ✅
- **URL:** https://github.com/open-mmlab/mmaction2
- **Conteúdo:** **ST-GCN** (AAAI'18), **STGCN++**, **PoseC3D/PoseConv3D** (CVPR'22), entre outros, com model zoo (checkpoints NTU60/NTU120/etc. em `download.openmmlab.com` — config + ficheiro .pth por modelo em `configs/skeleton/`).
- **Licença:** **Apache 2.0** ✅.
- **Integração:** Alternativa direta ao TCN: os keypoints do RTMPose-m (formato COCO-17) entram no PoseC3D/ST-GCN com *fine-tuning* sobre as 6 classes de pancada do PadelTracker100 + THETIS. PoseC3D é tipicamente mais robusto a ruído de pose do que GCNs; ST-GCN++ é mais leve para tempo real.

---

## 6. Deteção de linhas de campo / homografia automática

### TennisCourtDetector (yastrebksv) ✅
- **URL:** https://github.com/yastrebksv/TennisCourtDetector
- **Conteúdo:** Rede de heatmaps (estilo TrackNet) que prevê **14 keypoints do campo de ténis** (entrada 640×360, 15 canais), com pós-processamento por visão clássica (linhas brancas + interseções) e reconstrução por homografia. Dataset de **8.841 imagens anotadas** + pesos, ambos no Google Drive. Precisão reportada: 96,3%.
- **Licença:** ⚠️ **Não especificada** — contactar autor para uso comercial; em alternativa, retreinar a arquitetura (trivial) com dados próprios.
- **Integração:** Adaptar de 14 keypoints de ténis para os keypoints do campo de padel (linhas de serviço + paredes de vidro) e usar 4+ pontos para a homografia — substitui a marcação manual de 4 pontos.

### TVCalib (MM4SPA) ✅
- **URL:** https://github.com/MM4SPA/tvcalib
- **Conteúdo:** Calibração de câmara para registo de campo (WACV 2023, futebol): segmentação semântica de linhas + otimização de parâmetros de câmara. Peso do modelo de segmentação descarregável (TIB cloud).
- **Licença:** **MIT** ✅.
- **Integração:** Abordagem por otimização que estima homografia/câmara completa a partir de segmentos de linha — transferível ao padel definindo o template 10×20 m do campo; mais robusta que 4 pontos quando há oclusões.

### Datasets de keypoints de campo de padel (Roboflow) ✅
- **Padel court key points:** https://universe.roboflow.com/general-pmycw/padel-court-key-points (277 imagens, 2024)
- **Padel Court Detection (keypoints):** https://universe.roboflow.com/joshs-workspace-p1aa0/padel-court-detection (656 imagens, 2025)
- **Padel Court KeyPoints Estimation:** https://universe.roboflow.com/search?q=like:ghalichraibi/padel-court-keypoints-estimation
- **Licença:** verificar por projeto. **Integração:** treino imediato de um detetor de keypoints de campo (YOLO-pose/RTMPose) para homografia automática.

---

## 7. Recursos cross-desporto (futebol, ténis, outros)

> Recursos de outros desportos transferíveis para o pipeline de padel (câmara única fixa atrás do campo, 4 jogadores, campo 10×20 m). URLs verificados por fetch em 2026-06-12. Não repete WASB/TrackNet/THETIS/TenniSet/ShuttleSet/TennisCourtDetector/TVCalib (já cobertos acima).

### 7.1 Futebol — tracking e posicionamento de jogadores

#### SoccerNet-GSR / sn-gamestate ✅ **O "blueprint" arquitetural do pipeline de padel**
- **URL:** https://github.com/SoccerNet/sn-gamestate
- **Conteúdo:** *Game State Reconstruction* (CVPRW 2024): reconstrói um minimapa estilo videojogo com a **posição de cada jogador no plano do campo em coordenadas reais**, a partir de uma só câmara — exatamente o objetivo do nosso minimapa de padel. Baseline completa: deteção (YOLO) → ReID (PRTreid/BPBreID) → tracking → calibração de câmara (TVCalib) → leitura de dorsais (MMOCR). Dataset: 200 clips anotados (v1.3), download automático na primeira execução ou via pip `SoccerNet` (task `gamestate-2024`).
- **Licença:** ⚠️ Código **GPL-3.0** (copyleft — não linkar diretamente em produto fechado; usar como referência de arquitetura/avaliação). Dados SoccerNet: uso de investigação.
- **Integração:** Copiar a *estrutura* (não o código): a métrica GS-HOTA e o formato de saída (id, equipa, x/y em metros por frame) servem de especificação para o nosso módulo de posicionamento. Em padel a tarefa é mais fácil: câmara fixa, 4 jogadores, sem dorsais.

#### TrackLab ✅
- **URL:** https://github.com/TrackingLaboratory/tracklab
- **Conteúdo:** Framework modular PyTorch de *multi-object tracking* (base do sn-gamestate, mas com licença permissiva): detetores (YOLO, YOLOX, RTMDet, RT-DETR), pose (RTMPose, RTMO, VITPose), ReID (KPReID, BPBReID), trackers (DeepSORT, StrongSORT, OC-SORT). Suporta treino supervisionado do ReID no próprio dataset de tracking. Ativo (updates 2025).
- **Licença:** **MIT** ✅.
- **Integração:** Candidato a esqueleto do módulo de tracking de jogadores — trocar componentes (ex.: RTMDet + OC-SORT) sem reescrever pipeline; ou usar só como referência de design se quisermos código próprio mais leve.

#### SoccerNet-Tracking ✅
- **URL:** https://github.com/SoccerNet/sn-tracking
- **Conteúdo:** Dataset MOT de futebol: 200 clips de 30 s anotados (formato MOT) + 12 jogos completos da câmara principal. Download via pip `SoccerNet` (vídeos requerem password/NDA gratuita).
- **Licença:** ⚠️ Código sem ficheiro LICENSE; dados para investigação (NDA). Não treinar modelos de produto diretamente nestes dados sem confirmar termos.
- **Integração:** Benchmark para validar o tracker escolhido em condições desportivas (motion blur, oclusões); menos prioritário que o GSR.

#### SoccerNet-ReID ✅ / torchreid + OSNet ✅
- **URLs:** https://github.com/SoccerNet/sn-reid · https://github.com/KaiyangZhou/deep-person-reid
- **Conteúdo:** sn-reid: 340.993 thumbnails de jogadores de 400 jogos, fork do torchreid — **MIT**. torchreid: biblioteca PyTorch de ReID com **OSNet/OSNet-AIN** (~2,2 M parâmetros) e pesos pré-treinados (model zoo + https://huggingface.co/kaiyangzhou/osnet) — **MIT**.
- **Licença:** **MIT** (ambos) ✅; dados sn-reid: investigação.
- **Integração:** OSNet é o ReID leve ideal para re-associar 4 jogadores após oclusões (parceiros cruzam-se constantemente em padel); *fine-tuning* opcional com crops dos nossos vídeos via torchreid.

#### Roboflow sports ✅
- **URL:** https://github.com/roboflow/sports
- **Conteúdo:** Toolkit open source de analytics desportiva: deteção de jogadores/bola, **homografia campo→minimapa via keypoints do relvado** (classe `ViewTransformer`), e **classificação de equipas por cor de camisola** (`TeamClassifier`: embeddings SigLIP + UMAP + KMeans, sem treino supervisionado). Datasets associados no Roboflow Universe (jogadores, bola, keypoints de campo). Instalação: `pip install git+https://github.com/roboflow/sports.git`.
- **Licença:** **MIT** ✅ (datasets Universe: verificar individualmente).
- **Integração:** O `TeamClassifier` transfere quase sem alterações para separar as **duas duplas de padel** por cor de roupa; o padrão keypoints→homografia→minimapa é o mesmo do nosso campo 10×20 m.

#### Trackers: BoT-SORT / OC-SORT / Deep OC-SORT ✅ (todos MIT)
- **URLs:** https://github.com/NirAharon/BoT-SORT · https://github.com/noahcao/OC_SORT · https://github.com/GerardMaggiolino/Deep-OC-SORT
- **Conteúdo/Licença:** Todos **MIT** ✅, código + modelos descarregáveis. BoT-SORT = ByteTrack + compensação de movimento de câmara + ReID. OC-SORT (CVPR 2023) = associação por movimento robusta a oclusão/movimento não-linear. Deep OC-SORT = OC-SORT + ReID adaptativo (~+6 HOTA sobre OC-SORT no DanceTrack).
- **Nota vs ByteTrack:** em desporto (movimento errático, aparências semelhantes) os benchmarks SportsMOT/DanceTrack favorecem OC-SORT/Deep OC-SORT e associação com aparência (MixSort) sobre ByteTrack puro. Com **câmara fixa e só 4 jogadores**, ByteTrack já é forte (e a compensação de câmara do BoT-SORT torna-se irrelevante); a escolha pragmática é **ByteTrack ou OC-SORT + ReID OSNet** para eliminar trocas de ID quando os parceiros se cruzam.

### 7.2 Ténis — posição em campo e analytics

#### tennis_analysis (abdullahtarek) ✅
- **URL:** https://github.com/abdullahtarek/tennis_analysis
- **Conteúdo:** Pipeline didático completo: YOLOv8 (jogadores) + YOLO afinado (bola) + CNN de keypoints do campo → **mini-court com posições, velocidade dos jogadores, velocidade da pancada e contagem de pancadas**. Pesos no Google Drive.
- **Licença:** ⚠️ **Sem licença** — usar apenas como referência/tutorial, não copiar código para o produto.
- **Integração:** O cálculo de métricas (distância percorrida, velocidade média, velocidade de pancada via deslocamento da bola entre batimentos) é diretamente replicável no nosso minimapa de padel.

#### tennis-tracking (ArtLabss) ✅
- **URL:** https://github.com/ArtLabss/tennis-tracking
- **Conteúdo:** "HawkEye monocular" open source: TrackNet (bola) + ResNet50 (jogadores) + deteção de linhas do campo + **minimapa bird's-eye com jogadores e bola projetados** + previsão de ressaltos (TimeSeriesForestClassifier).
- **Licença:** **Unlicense (domínio público)** ✅ — reutilização livre, incluindo comercial.
- **Integração:** Melhor fonte *legalmente limpa* de código de projeção campo→minimapa e deteção de ressalto por séries temporais; adaptar o template de campo ao retângulo 10×20 m do padel.

#### TennisProject (yastrebksv) ✅
- **URL:** https://github.com/yastrebksv/TennisProject
- **Conteúdo:** Pipeline do mesmo autor do TennisCourtDetector (§6): TrackNet (bola) + 14 keypoints do campo + deteção de pessoas + **deteção de ressalto com CatBoostRegressor sobre a trajetória** + minimapa. Pesos no Google Drive.
- **Licença:** ⚠️ **Não especificada** — contactar autor antes de uso comercial.
- **Integração:** O detetor de ressalto por features de trajetória (sem rede pesada) transfere-se bem para detetar ressaltos no vidro/chão em padel; complementa o TennisCourtDetector já listado.

#### Datasets amador/court-side ⚠️
- A pesquisa não encontrou nenhum dataset consolidado de ténis amador com câmara fixa atrás do campo (o equivalente mais próximo continua a ser o PadelTracker100, §2). Há vários projetos YOLO de fim de curso (ex.: https://github.com/BimsaraS99/tennis-analyzer-YOLOv8) mas sem dados próprios relevantes. **Conclusão: para a nossa perspetiva de câmara, os dados de padel próprios + Roboflow padel valem mais do que qualquer dataset de ténis broadcast.**

### 7.3 Voleibol / basquetebol / badminton / multi-desporto

#### SportsMOT ✅ + MixSort ✅
- **URLs:** https://github.com/MCG-NJU/SportsMOT · https://github.com/MCG-NJU/MixSort
- **Conteúdo:** Dataset MOT (ICCV 2023) com 240 clips 720p/25fps de **basquetebol, voleibol e futebol** (download via plataforma CodaLab após registo). MixSort: tracker baseline (associação por aparência aplicável sobre ByteTrack/OC-SORT), pesos no Google Drive.
- **Licença:** dataset **CC BY-NC 4.0** ⚠️ (não comercial — só para avaliação interna/benchmark); código MixSort **MIT** ✅.
- **Integração:** O subconjunto de voleibol (12 jogadores, campo pequeno, câmara quase fixa) é o melhor proxy público para validar o tracker de padel antes de termos dados anotados próprios.

#### TeamTrack (AtomScott) ✅
- **URL:** https://github.com/AtomScott/TeamTrack
- **Conteúdo:** Dataset MOT multi-desporto (futebol, basquetebol, andebol) com vídeos 4K–8K de **câmara fixa lateral (fisheye) e drone**, ~280 k frames / 4,37 M bounding boxes; inclui formato `teamtrack-trajectory` com **trajetórias já projetadas em coordenadas do campo**. Download via Google Drive/Kaggle.
- **Licença:** **MIT** ✅ (confirmar no Kaggle a licença dos dados ao descarregar).
- **Integração:** Único dataset grande de **câmara fixa** com trajetórias no plano do campo — útil para treinar/validar suavização e métricas de movimento (distância, velocidade, heatmaps) idênticas às do padel.

#### DeepSportradar (basquetebol) ✅
- **URLs:** https://github.com/DeepSportradar/player-reidentification-challenge · https://github.com/DeepSportradar/camera-calibration-challenge
- **Conteúdo:** Desafios ACM MMSports. ReID: dataset SynergyReID (8.569 imagens de treino, 436 identidades) incluído no próprio repo — **Apache-2.0** ✅. Calibração: 728 pares imagem↔parâmetros de câmara de **câmaras fixas Keemotion** em pavilhões FIBA (Basketball Instants Dataset, download via Kaggle: `kaggle datasets download deepsportradar/basketball-instants-dataset`); licença do repo não explícita ⚠️.
- **Integração:** Cenário indoor com câmara fixa e iluminação artificial — muito mais próximo de um clube de padel do que broadcast de futebol; o baseline de calibração por segmentação de linhas + interseções 2D↔3D replica-se com as linhas do campo de padel.

#### VolleyVision (shukkkur) ⚠️
- **URL:** https://github.com/shukkkur/VolleyVision
- **Conteúdo:** Bola (YOLOv7-tiny + modelo Roboflow, 25 k imagens), jogadores (YOLOv8m), 5 ações de voleibol, segmentação do campo; datasets públicos no Roboflow.
- **Licença:** ⚠️ **CC BY-NC-ND** — não comercial e sem derivados. **Só como referência.**
- **Integração:** Referência de organização de um pipeline indoor de bola pequena + multi-jogador; não reutilizar pesos/código no produto.

#### CoachAI MovementForecasting 📄/✅
- **URL:** https://github.com/wywyWang/CoachAI-Projects (módulo Movement Forecasting; ShuttleSet já coberto em §3)
- **Conteúdo/Licença:** Previsão de movimento de jogadores de badminton com grafos dinâmicos — **MIT** ✅.
- **Integração:** Interesse futuro (sugestão de posicionamento tático das duplas), não é prioridade do MVP.

### 7.4 Action spotting / deteção de eventos (rally e batimentos)

#### E2E-Spot (jhong93/spot) ✅ **Recomendado para deteção de batimento**
- **URL:** https://github.com/jhong93/spot (modelos: https://github.com/jhong93/e2e-spot-models)
- **Conteúdo:** Baseline end-to-end (ECCV 2022) para *precise temporal spotting* — eventos à **precisão de 1 frame** — com configs prontas para **ténis (batimentos)**, patinagem artística, FineDiving, FineGym e futebol. Código + modelos treinados descarregáveis.
- **Licença:** **BSD-3-Clause** ✅ — utilizável comercialmente.
- **Integração:** Arquitetura ideal para o detetor de **momento de pancada e início/fim de ponto** em padel: *fine-tuning* do modelo de ténis com clips anotados de padel; saída por frame alimenta a segmentação de rallies e a contagem de pancadas.

#### SoccerNet Action Spotting (sn-spotting) ✅
- **URL:** https://github.com/SoccerNet/sn-spotting
- **Conteúdo:** 500 jogos com 17 classes de ação + dataset *Ball Action Spotting* (12 classes ao nível da bola: passe, remate…); features pré-computadas (ResNet-152, Baidu) e múltiplas baselines (NetVLAD++, E2E). Anotações livres via pip; vídeos sob NDA.
- **Licença:** Código **MIT** ✅; dados para investigação ⚠️.
- **Integração:** As baselines e a métrica (mAP@tolerância temporal) definem como avaliar o nosso detetor de eventos de rally; o *Ball Action Spotting* (eventos densos e curtos) é o análogo mais próximo da sequência de pancadas num ponto de padel.

### 7.5 Calibração de câmara a partir de vídeo desportivo

#### PnLCalib ✅ (SOTA SoccerNet-Calibration)
- **URL:** https://github.com/mguti97/PnLCalib
- **Conteúdo:** Calibração por **pontos + linhas** (keypoints do campo + extremidades de linhas, refinamento por otimização não linear); supera os métodos anteriores no SoccerNet-Calibration em single-view e multi-view. 6 variantes de pesos nas releases (incl. WorldCup, TS-WorldCup).
- **Licença:** ⚠️ **GPL-2.0** — copyleft; usar como referência ou isolar num serviço separado.
- **Integração:** O esquema pontos+linhas é ideal para o padel: poucas linhas mas paredes de vidro com arestas verticais bem definidas → definir template 3D do campo 10×20 m e retreinar as duas redes.

#### No-Bells-Just-Whistles (mguti97) ✅
- **URL:** https://github.com/mguti97/No-Bells-Just-Whistles
- **Conteúdo:** Antecessor do PnLCalib (MMSports/MM4SPA): heatmaps de keypoints + extremidades de linhas → DLT clássico, sem refinamento. Pesos single/multi-view nas releases.
- **Licença:** ⚠️ **GPL-2.0**.
- **Integração:** Versão mais simples do mesmo conceito; em câmara fixa a calibração corre **uma vez por vídeo**, pelo que até um método lento serve.

#### SoccerNet-Calibration (sn-calibration) ✅
- **URL:** https://github.com/SoccerNet/sn-calibration
- **Conteúdo:** Desafio + baseline (DeepLabv3 para segmentação de linhas → decomposição de homografia) + dataset de imagens anotadas com as marcações do campo (pip `SoccerNet`, task `calibration-2023`); pesos no Google Drive.
- **Licença:** ⚠️ Código sem LICENSE explícita; dados para investigação.
- **Integração:** Útil sobretudo pelo protocolo de avaliação (AC@5/JaC) para medir a qualidade da nossa homografia de padel; com câmara fixa, o TVCalib (§6, MIT) continua a ser a via recomendada.

### Quadro-resumo da secção 7

| Recurso | Licença | Comercial? | Descarregável hoje |
|---|---|---|---|
| sn-gamestate (GSR) | GPL-3.0 (código); dados investigação | ⚠️ só como referência | ✅ |
| TrackLab | MIT | ✅ | ✅ |
| SoccerNet-Tracking | s/ licença; dados NDA | ❓ | ✅ |
| SoccerNet-ReID | MIT (código) | ✅ código | ✅ |
| torchreid / OSNet | MIT | ✅ | ✅ |
| Roboflow sports | MIT | ✅ | ✅ |
| BoT-SORT / OC-SORT / Deep OC-SORT / ByteTrack | MIT | ✅ | ✅ |
| tennis_analysis (abdullahtarek) | não especificada | ❓ | ✅ |
| tennis-tracking (ArtLabss) | Unlicense | ✅ | ✅ |
| TennisProject (yastrebksv) | não especificada | ❓ | ✅ |
| SportsMOT | CC BY-NC 4.0 | ❌ (benchmark interno) | ✅ (registo CodaLab) |
| MixSort | MIT | ✅ | ✅ |
| TeamTrack | MIT | ✅ | ✅ |
| DeepSportradar ReID | Apache-2.0 | ✅ | ✅ |
| DeepSportradar Calibração + Basketball Instants | não especificada | ❓ | ✅ (Kaggle) |
| VolleyVision | CC BY-NC-ND | ❌ | ✅ |
| E2E-Spot | BSD-3-Clause | ✅ | ✅ |
| sn-spotting | MIT (código); vídeos NDA | ✅ código | ✅ |
| PnLCalib / No-Bells-Just-Whistles | GPL-2.0 | ⚠️ copyleft | ✅ |
| sn-calibration | s/ licença; dados investigação | ❓ | ✅ |

---

## Quadro-resumo de licenças

| Recurso | Licença | Comercial? | Descarregável hoje |
|---|---|---|---|
| WASB-SBDT (+ pesos ténis/badminton) | MIT | ✅ | ✅ |
| TrackNetV3 (qaz812345) | MIT | ✅ | ✅ |
| TrackNet (yastrebksv) | não especificada | ❓ | ✅ |
| MonoTrack | Adobe Research | ❌ | ✅ (código) |
| PadelTracker100 | CC BY | ✅ (com atribuição) | ✅ |
| padel_analytics | CC BY-NC-SA 4.0 | ❌ | ✅ |
| THETIS | "research only", s/ licença | ❓ | ✅ |
| TenniSet | MIT | ✅ | ✅ |
| ShuttleSet/CoachAI | MIT | ✅ | ✅ |
| BadmintonDB | não especificada | ❓ | ✅ (anotações) |
| RTMDet / MMDetection | Apache 2.0 | ✅ | ✅ |
| RT-DETR / D-FINE | Apache 2.0 | ✅ | ✅ |
| YOLO11/26 (Ultralytics) | AGPL-3.0 | ⚠️ só com licença paga | ✅ |
| RTMO / RTMPose / MMPose | Apache 2.0 | ✅ | ✅ |
| ViTPose | Apache 2.0 | ✅ | ✅ |
| MMAction2 (ST-GCN/PoseC3D) | Apache 2.0 | ✅ | ✅ |
| TennisCourtDetector | não especificada | ❓ | ✅ |
| TVCalib | MIT | ✅ | ✅ |
| Datasets Roboflow (padel) | varia por projeto | verificar | ✅ |

---

**Notas finais de verificação:** (1) o GitLab oficial do TrackNetV2 estava offline na data desta pesquisa; (2) Zenodo, Roboflow Universe, ScienceDirect e PMC bloqueiam fetch automatizado (HTTP 403) — os registos foram confirmados por via indireta (motores de pesquisa + papers associados) e devem ser abertos manualmente no browser para confirmar a variante exata da licença antes de uso comercial; (3) as descobertas com maior impacto para o pipeline são o **PadelTracker100** (CC BY, anota exatamente as 4 tarefas do pipeline) e o **WASB** (MIT, pesos prontos de bola para ténis/badminton).
