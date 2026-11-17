// Arranca un filtro facial: camara + MediaPipe + escena JSON del editor de three.js
// + Filtro tactico Night-Bites Vision (vision nocturna al cerrar ojos, dorado al sonreir).

import GUI from "https://cdn.jsdelivr.net/npm/lil-gui@0.20.0/+esm";

import WebCamera from "../webcamera.js";
import ThreePlayer from "../app.js";
import MPFaceTracker from "./mp_face_tracker.js";
import MPFaceRenderer from "./mp_face_renderer.js";
import ThreeFaceRenderer from "./three_face_renderer.js";
import FaceEvents from "./face_events.js";
import NightVisionFilter from "./night_vision_filter.js";

const MASK_NAME = "mesh_0";

export async function startFaceFilter(scenePath, { showGui = true } = {}) {

    const app = document.getElementById("app");
    const video = document.getElementById("video-renderer");
    const canvas = document.getElementById("canvas-renderer");
    const hudCanvas = document.getElementById("hud-canvas");

    // Camara y seguimiento de la cara
    const webCamera = new WebCamera(video);
    await webCamera.startCamera();

    const tracker = new MPFaceTracker(video);
    await tracker.init();

    const faceEvents = new FaceEvents();

    // Ayudas 2D de MediaPipe (malla, puntos, contornos) sobre el video
    const mpRenderer = new MPFaceRenderer(video, canvas);

    // Escena 3D del editor
    const player = new ThreePlayer(app);
    player.face = faceEvents;
    faceEvents.addListener((type, face) => player.dispatch(type, face));
    await player.loadProject(scenePath);

    const faceRenderer = new ThreeFaceRenderer(video, player);
    faceRenderer.alignCamera();

    // La mascara sale del grupo de la escena: se coloca vertice a vertice en la cara.
    const mask = player.rootNode.getObjectByName(MASK_NAME);
    if (mask) {
        for (const child of [...mask.children]) mask.parent.attach(child);
        faceRenderer.faceGroup.add(mask);
    }

    // Si se carga la escena base por defecto ("app.json"), ocultamos los accesorios
    // de ejemplo (gafas/nariz/burbujas) para que no tapen el filtro Night-Bites Vision.
    const isDefaultScene = !new URLSearchParams(location.search).has("json");
    if (isDefaultScene) {
        const demoAccessories = player.rootNode.getObjectByName("Accesorios");
        if (demoAccessories) {
            demoAccessories.visible = false;
            demoAccessories.traverse((obj) => { obj.visible = false; });
        }
        // Detener audios de ejemplo de la escena base para que no interfieran con el resplandor
        player.assets?.audios?.forEach((a) => a.stop?.());
    }

    // Inicializar filtro Night-Bites Vision (Three.js + Shader + HUD + Audio Resplandor)
    const nightVisionFilter = new NightVisionFilter({
        video,
        hudCanvas,
        player,
        faceRenderer,
        faceEvents,
    });
    nightVisionFilter.audio.unlock();

    const settings = { headScale: 1 };

    function update() {

        tracker.update();
        faceEvents.update(tracker);

        const landmarks = tracker.getLandmarks();

        mpRenderer.drawMesh(landmarks);
        mpRenderer.drawPoints(landmarks);
        mpRenderer.drawIrises(landmarks);
        mpRenderer.drawContours(landmarks);

        faceRenderer.drawMesh(landmarks);
        faceRenderer.drawConnectors(landmarks);
        faceRenderer.drawContours(landmarks);
        faceRenderer.drawIrises(landmarks);
        faceRenderer.drawPoints(landmarks);
        if (mask) faceRenderer.syncFaceMesh(mask);

        // La escena sigue la cabeza (solo se oculta si no hay cara).
        const detected = tracker.getFaceCount() > 0;
        player.rootNode.visible = detected;
        if (mask) mask.visible = detected && !isDefaultScene;

        const pose = detected ? faceRenderer.getHeadPose() : null;
        if (pose) {
            player.rootNode.position.copy(pose.position);
            player.rootNode.quaternion.copy(pose.quaternion);
            player.rootNode.scale.setScalar(pose.scale * settings.headScale);
        }

        // Actualizar vision nocturna, ojos/boca neon, reticula facial y HUD tactico
        nightVisionFilter.update(landmarks, detected);

        player.update();
        requestAnimationFrame(update);

    }

    window.addEventListener("resize", () => {
        mpRenderer.resize();
        player.resize();
        faceRenderer.alignCamera();
        nightVisionFilter.resize();
    });

    if (showGui) createGui(settings, mpRenderer, faceRenderer, nightVisionFilter);

    update();

    // Para depurar desde la consola del navegador.
    const filter = { webCamera, tracker, faceEvents, mpRenderer, player, faceRenderer, mask, nightVisionFilter };
    window.faceFilter = filter;
    return filter;

}

function createGui(settings, mpRenderer, faceRenderer, nightVisionFilter) {

    const gui = new GUI({ title: "Controles" });
    gui.close();

    const nvFolder = gui.addFolder("Night-Bites Vision");
    nvFolder.add(nightVisionFilter, "nightVision")
        .name("Visión Nocturna (Cerrar ojos)")
        .listen()
        .onChange((val) => {
            nightVisionFilter.audio.playShimmer(val ? "nv_on" : "nv_off");
        });
    nvFolder.add(nightVisionFilter, "goldMode")
        .name("Modo Dorado (Sonreír)")
        .listen()
        .onChange((val) => {
            if (nightVisionFilter.nightVision) {
                nightVisionFilter.audio.playShimmer(val ? "gold" : "green");
            }
        });
    nvFolder.add({ testSound: () => nightVisionFilter.audio.playShimmer("nv_on") }, "testSound")
        .name("Probar sonido resplandor");

    const helpers2D = gui.addFolder("Ayudas 2D (MediaPipe)");
    helpers2D.add(mpRenderer, "showHelpers").name("Mostrar");
    helpers2D.add(mpRenderer, "showMesh").name("Malla");
    helpers2D.add(mpRenderer, "showPoints").name("Puntos");
    helpers2D.add(mpRenderer, "showContours").name("Contornos");
    helpers2D.add(mpRenderer, "showIrises").name("Iris");

    const helpers3D = gui.addFolder("Ayudas 3D (three.js)");
    helpers3D.add(faceRenderer, "showHelpers").name("Mostrar");
    helpers3D.add(faceRenderer, "showMesh").name("Malla");
    helpers3D.add(faceRenderer, "showConnectors").name("Conexiones");
    helpers3D.add(faceRenderer, "showPoints").name("Puntos");
    helpers3D.add(faceRenderer, "showContours").name("Contornos");
    helpers3D.add(faceRenderer, "showIrises").name("Iris");

    const scene = gui.addFolder("Escena");
    scene.add(settings, "headScale", 0.1, 5).name("Escala de la cabeza");
    scene.add(faceRenderer, "exportAndDownloadMesh").name("Exportar malla capturada (.glb)");

}
