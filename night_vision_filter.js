import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.181.1/build/three.module.js";

// ============================================================================
// 1. SINTETIZADOR DE SONIDO "RESPLANDOR" (Web Audio API, ~0.32s, sin archivos)
// ============================================================================
class ShimmerAudio {
    constructor() {
        this.ctx = null;
        this.lastPlayTime = 0;

        const unlock = () => this.unlock();
        window.addEventListener("pointerdown", unlock, { passive: true });
        window.addEventListener("keydown", unlock, { passive: true });
        window.addEventListener("touchstart", unlock, { passive: true });
    }

    ensureContext() {
        if (!this.ctx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) {
                this.ctx = new AudioCtx();
            }
        }
        return this.ctx;
    }

    unlock() {
        const ctx = this.ensureContext();
        if (ctx && ctx.state === "suspended") {
            ctx.resume().catch(() => {});
        }
    }

    /**
     * Reproduce un sonido corto y cristalino parecido a un resplandor (~0.32 s).
     * @param {"nv_on"|"nv_off"|"gold"|"green"} mode
     */
    playShimmer(mode = "nv_on") {
        const nowPerf = performance.now();
        if (nowPerf - this.lastPlayTime < 220) return;
        this.lastPlayTime = nowPerf;

        const ctx = this.ensureContext();
        if (!ctx) return;
        if (ctx.state === "suspended") {
            ctx.resume().catch(() => {});
        }

        const t0 = ctx.currentTime;
        const duration = 0.32;

        // Frecuencias armonicas luminosas segun la accion
        const baseFreqs =
            mode === "gold"
                ? [1046.5, 1567.98, 2093.0, 3135.96] // Acorde dorado brillante (C6-G6-C7-G7)
                : mode === "nv_off"
                    ? [987.77, 1318.51, 1760.0]      // Descenso suave al apagar
                    : [880.0, 1318.51, 1760.0, 2637.02]; // Destello neon (A5-E6-A6-E7)

        const pitchMultiplier = mode === "nv_off" ? 0.88 : 1.14;

        const masterGain = ctx.createGain();
        masterGain.gain.setValueAtTime(0.0001, t0);
        masterGain.gain.linearRampToValueAtTime(0.16, t0 + 0.018);
        masterGain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
        masterGain.connect(ctx.destination);

        // Parciales armonicos cristalinos con ligero desplazamiento de frecuencia
        baseFreqs.forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const partGain = ctx.createGain();

            osc.type = idx % 2 === 0 ? "sine" : "triangle";
            osc.frequency.setValueAtTime(freq, t0);
            osc.frequency.exponentialRampToValueAtTime(freq * pitchMultiplier, t0 + duration);

            const weight = 0.42 / (idx + 1);
            partGain.gain.setValueAtTime(weight, t0);
            partGain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration * (0.95 - idx * 0.08));

            osc.connect(partGain);
            partGain.connect(masterGain);

            osc.start(t0);
            osc.stop(t0 + duration + 0.02);
        });

        // Destello de aire agudo filtrado (efecto brillo optico)
        const bufferSize = Math.floor(ctx.sampleRate * duration);
        const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.35));
        }

        const noise = ctx.createBufferSource();
        noise.buffer = noiseBuffer;

        const filter = ctx.createBiquadFilter();
        filter.type = "bandpass";
        filter.Q.value = 4.5;
        filter.frequency.setValueAtTime(3600, t0);
        filter.frequency.exponentialRampToValueAtTime(6800, t0 + duration);

        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(0.0001, t0);
        noiseGain.gain.linearRampToValueAtTime(0.07, t0 + 0.015);
        noiseGain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration * 0.85);

        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(ctx.destination);

        noise.start(t0);
        noise.stop(t0 + duration + 0.02);
    }
}

// ============================================================================
// 2. PASE DE VISION NOCTURNA EN THREE.JS (Shader GLSL Verde Neon <-> Dorado)
// ============================================================================
class NightVisionVideoPass {
    constructor(video, player) {
        this.video = video;
        this.player = player;
        this.depth = -5; // Distancia desde z=0 (la camara esta en z=10)

        this.texture = new THREE.VideoTexture(video);
        this.texture.minFilter = THREE.LinearFilter;
        this.texture.magFilter = THREE.LinearFilter;
        this.texture.colorSpace = THREE.SRGBColorSpace;

        this.uniforms = {
            uMap: { value: this.texture },
            uGoldMix: { value: 0.0 },
            uTime: { value: 0.0 },
        };

        const material = new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            depthTest: false,
            depthWrite: false,
            vertexShader: /* glsl */ `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */ `
                uniform sampler2D uMap;
                uniform float uGoldMix;
                uniform float uTime;
                varying vec2 vUv;

                float hash(vec2 p) {
                    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
                }

                void main() {
                    vec4 texel = texture2D(uMap, vUv);

                    // Luminancia perceptual
                    float lum = dot(texel.rgb, vec3(0.299, 0.587, 0.114));

                    // Curva de contraste cinematografica de vision nocturna
                    lum = clamp(pow(lum, 0.86) * 1.16 + 0.02, 0.0, 1.0);

                    // Paleta Verde Fosforo P43 (como la imagen de referencia)
                    vec3 greenShadow    = vec3(0.012, 0.075, 0.022);
                    vec3 greenMid       = vec3(0.155, 0.615, 0.225);
                    vec3 greenHighlight = vec3(0.700, 1.000, 0.720);

                    vec3 greenRamp = lum < 0.5
                        ? mix(greenShadow, greenMid, lum * 2.0)
                        : mix(greenMid, greenHighlight, (lum - 0.5) * 2.0);

                    // Paleta Dorada Luminosa (al sonreir)
                    vec3 goldShadow     = vec3(0.075, 0.048, 0.005);
                    vec3 goldMid        = vec3(0.780, 0.565, 0.110);
                    vec3 goldHighlight  = vec3(1.000, 0.935, 0.580);

                    vec3 goldRamp = lum < 0.5
                        ? mix(goldShadow, goldMid, lum * 2.0)
                        : mix(goldMid, goldHighlight, (lum - 0.5) * 2.0);

                    vec3 color = mix(greenRamp, goldRamp, uGoldMix);

                    // Lineas de escaneo opticas muy sutiles + grano de sensor nocturno
                    float scanline = sin(vUv.y * 720.0) * 0.018;
                    float grain = (hash(vUv * 512.0 + fract(uTime)) - 0.5) * 0.032;
                    color += scanline + grain;

                    // Viñeta periferica suave
                    vec2 dist = (vUv - 0.5) * vec2(1.15, 1.05);
                    float vignette = 1.0 - smoothstep(0.38, 0.95, dot(dist, dist));
                    color *= mix(0.68, 1.04, vignette);

                    gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
                }
            `,
        });

        this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
        this.mesh.name = "NightVisionVideoQuad";
        this.mesh.position.set(0, 0, this.depth);
        this.mesh.renderOrder = -100;
        this.mesh.frustumCulled = false;
        this.mesh.visible = false;

        this.player.mainScene.add(this.mesh);
        this.resize();
    }

    resize() {
        const vw = this.video.videoWidth;
        const vh = this.video.videoHeight;
        if (!vw || !vh) return;

        const videoAspect = vw / vh;
        const camZ = this.player.camera.position.z || 10;
        const scaleAtDepth = (camZ - this.depth) / 10;

        this.mesh.scale.set(videoAspect * scaleAtDepth, 1.0 * scaleAtDepth, 1);
    }

    update(visible, goldMix, timeSec) {
        this.mesh.visible = visible;
        if (!visible) return;
        if (this.mesh.scale.x === 1 && this.video.videoWidth) {
            this.resize();
        }
        this.uniforms.uGoldMix.value = goldMix;
        this.uniforms.uTime.value = timeSec;
    }
}

// ============================================================================
// 3. OJOS Y BOCA NEON EN 3D (Deformados en tiempo real con landmarks MediaPipe)
// ============================================================================
const LEFT_EYE_LOOP = [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7];
const RIGHT_EYE_LOOP = [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249];
const LEFT_IRIS_CENTER = 468;
const RIGHT_IRIS_CENTER = 473;

const OUTER_LIP_LOOP = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146];
const INNER_LIP_LOOP = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95];

class NeonFaceFeatures {
    constructor(video, faceGroup) {
        this.video = video;
        this.group = new THREE.Group();
        this.group.name = "NeonFaceFeatures";
        this.group.visible = false;
        faceGroup.add(this.group);

        this.uniforms = {
            uGoldMix: { value: 0.0 },
            uIntensity: { value: 1.0 },
            uMouthBoost: { value: 0.45 },
        };

        // Mallas de ojos (abanico triangulado desde el iris hasta el borde del parpado)
        this.leftEyeMesh = this.createEyeMesh(LEFT_EYE_LOOP.length);
        this.rightEyeMesh = this.createEyeMesh(RIGHT_EYE_LOOP.length);
        this.group.add(this.leftEyeMesh, this.rightEyeMesh);

        // Halos suaves de resplandor sobre cada iris
        this.leftEyeHalo = this.createGlowHalo();
        this.rightEyeHalo = this.createGlowHalo();
        this.group.add(this.leftEyeHalo, this.rightEyeHalo);

        // Malla de labios (anillo entre contorno exterior e interior) + brillo interior de sonrisa
        this.lipsMesh = this.createLipsRingMesh(OUTER_LIP_LOOP.length);
        this.innerMouthMesh = this.createInnerMouthMesh(INNER_LIP_LOOP.length);
        this.group.add(this.lipsMesh, this.innerMouthMesh);
    }

    createEyeMesh(loopCount) {
        // Vertice 0 = centro del iris (radial = 0), vertices 1..loopCount = borde parpado (radial = 1)
        const vertexCount = loopCount + 1;
        const positions = new Float32Array(vertexCount * 3);
        const radials = new Float32Array(vertexCount);
        radials[0] = 0.0;
        for (let i = 1; i < vertexCount; i++) {
            radials[i] = 1.0;
        }

        const indices = [];
        for (let i = 0; i < loopCount; i++) {
            const next = (i + 1) % loopCount;
            indices.push(0, i + 1, next + 1);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute("aRadial", new THREE.BufferAttribute(radials, 1));
        geometry.setIndex(indices);

        const material = new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            vertexShader: /* glsl */ `
                attribute float aRadial;
                varying float vRadial;
                void main() {
                    vRadial = aRadial;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */ `
                uniform float uGoldMix;
                uniform float uIntensity;
                varying float vRadial;

                void main() {
                    // Difuminado suave hacia el borde del parpado + nucleo blanco-neon intenso
                    float edgeFade = pow(clamp(1.0 - vRadial, 0.0, 1.0), 1.35);
                    float hotCore  = pow(clamp(1.0 - vRadial, 0.0, 1.0), 2.8);

                    vec3 neonGreen = vec3(0.22, 1.00, 0.32);
                    vec3 coreGreen = vec3(0.88, 1.00, 0.90);

                    vec3 neonGold  = vec3(1.00, 0.82, 0.14);
                    vec3 coreGold  = vec3(1.00, 0.98, 0.82);

                    vec3 outerCol = mix(neonGreen, neonGold, uGoldMix);
                    vec3 innerCol = mix(coreGreen, coreGold, uGoldMix);

                    vec3 col = mix(outerCol, innerCol, hotCore);
                    float alpha = edgeFade * uIntensity * 0.95;

                    gl_FragColor = vec4(col * alpha, alpha);
                }
            `,
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        mesh.renderOrder = 20;
        return mesh;
    }

    createGlowHalo() {
        const material = new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            vertexShader: /* glsl */ `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */ `
                uniform float uGoldMix;
                uniform float uIntensity;
                varying vec2 vUv;

                void main() {
                    float d = length((vUv - 0.5) * 2.0);
                    float glow = exp(-d * d * 4.5) * smoothstep(1.0, 0.15, d);

                    vec3 greenGlow = vec3(0.20, 1.00, 0.34);
                    vec3 goldGlow  = vec3(1.00, 0.80, 0.15);
                    vec3 col = mix(greenGlow, goldGlow, uGoldMix);

                    float alpha = glow * uIntensity * 0.52;
                    gl_FragColor = vec4(col * alpha, alpha);
                }
            `,
        });

        const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
        plane.frustumCulled = false;
        plane.renderOrder = 19;
        return plane;
    }

    createLipsRingMesh(ringCount) {
        // 0..ringCount-1 = contorno exterior (band = 0), ringCount..2*ringCount-1 = contorno interior (band = 1)
        const totalVerts = ringCount * 2;
        const positions = new Float32Array(totalVerts * 3);
        const band = new Float32Array(totalVerts);

        for (let i = 0; i < ringCount; i++) {
            band[i] = 0.0;
            band[ringCount + i] = 1.0;
        }

        const indices = [];
        for (let i = 0; i < ringCount; i++) {
            const next = (i + 1) % ringCount;
            const o0 = i;
            const o1 = next;
            const in0 = ringCount + i;
            const in1 = ringCount + next;
            indices.push(o0, in0, o1);
            indices.push(o1, in0, in1);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute("aBand", new THREE.BufferAttribute(band, 1));
        geometry.setIndex(indices);

        const material = new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            vertexShader: /* glsl */ `
                attribute float aBand;
                varying float vBand;
                void main() {
                    vBand = aBand;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */ `
                uniform float uGoldMix;
                uniform float uIntensity;
                uniform float uMouthBoost;
                varying float vBand;

                void main() {
                    // Difuminado suave en el borde de la piel (vBand=0) y brillo intenso en el labio
                    float outerFeather = smoothstep(0.0, 0.45, vBand);
                    float ridge = sin(vBand * 3.14159265);
                    float strength = mix(outerFeather, ridge, 0.45) * (0.62 + uMouthBoost * 0.38);

                    vec3 neonGreen = vec3(0.20, 1.00, 0.30);
                    vec3 coreGreen = vec3(0.75, 1.00, 0.78);

                    vec3 neonGold  = vec3(1.00, 0.80, 0.12);
                    vec3 coreGold  = vec3(1.00, 0.96, 0.72);

                    vec3 baseCol = mix(neonGreen, neonGold, uGoldMix);
                    vec3 hiCol   = mix(coreGreen, coreGold, uGoldMix);
                    vec3 col     = mix(baseCol, hiCol, ridge * 0.55);

                    float alpha = strength * uIntensity * 0.78;
                    gl_FragColor = vec4(col * alpha, alpha);
                }
            `,
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        mesh.renderOrder = 20;
        return mesh;
    }

    createInnerMouthMesh(loopCount) {
        const vertexCount = loopCount + 1;
        const positions = new Float32Array(vertexCount * 3);
        const radials = new Float32Array(vertexCount);
        radials[0] = 0.0;
        for (let i = 1; i < vertexCount; i++) {
            radials[i] = 1.0;
        }

        const indices = [];
        for (let i = 0; i < loopCount; i++) {
            const next = (i + 1) % loopCount;
            indices.push(0, i + 1, next + 1);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute("aRadial", new THREE.BufferAttribute(radials, 1));
        geometry.setIndex(indices);

        const material = new THREE.ShaderMaterial({
            uniforms: this.uniforms,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            vertexShader: /* glsl */ `
                attribute float aRadial;
                varying float vRadial;
                void main() {
                    vRadial = aRadial;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */ `
                uniform float uGoldMix;
                uniform float uIntensity;
                uniform float uMouthBoost;
                varying float vRadial;

                void main() {
                    float glow = pow(clamp(1.0 - vRadial * 0.65, 0.0, 1.0), 1.2);
                    vec3 greenCol = vec3(0.24, 1.00, 0.36);
                    vec3 goldCol  = vec3(1.00, 0.84, 0.20);
                    vec3 col = mix(greenCol, goldCol, uGoldMix);

                    float alpha = glow * uIntensity * uMouthBoost * 0.65;
                    gl_FragColor = vec4(col * alpha, alpha);
                }
            `,
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        mesh.renderOrder = 19;
        return mesh;
    }

    update(visible, landmarks, faceEvents, goldMix) {
        if (!visible || !landmarks || landmarks.length < 478 || !this.video.videoWidth) {
            this.group.visible = false;
            return;
        }

        this.group.visible = true;
        const aspect = this.video.videoWidth / this.video.videoHeight;

        const writeLandmark = (arr, offset, idx, zBias = 0.004) => {
            const lm = landmarks[idx];
            arr[offset] = (lm.x - 0.5) * aspect;
            arr[offset + 1] = -(lm.y - 0.5);
            arr[offset + 2] = -lm.z * aspect + zBias;
        };

        // 1. Ojo izquierdo
        const lPos = this.leftEyeMesh.geometry.attributes.position.array;
        writeLandmark(lPos, 0, LEFT_IRIS_CENTER, 0.006);
        for (let i = 0; i < LEFT_EYE_LOOP.length; i++) {
            writeLandmark(lPos, (i + 1) * 3, LEFT_EYE_LOOP[i], 0.004);
        }
        this.leftEyeMesh.geometry.attributes.position.needsUpdate = true;

        // 2. Ojo derecho
        const rPos = this.rightEyeMesh.geometry.attributes.position.array;
        writeLandmark(rPos, 0, RIGHT_IRIS_CENTER, 0.006);
        for (let i = 0; i < RIGHT_EYE_LOOP.length; i++) {
            writeLandmark(rPos, (i + 1) * 3, RIGHT_EYE_LOOP[i], 0.004);
        }
        this.rightEyeMesh.geometry.attributes.position.needsUpdate = true;

        // 3. Halos de iris
        const lIris = landmarks[LEFT_IRIS_CENTER];
        const lOuter = landmarks[33];
        const lInner = landmarks[133];
        const lEyeWidth = Math.hypot((lOuter.x - lInner.x) * aspect, lOuter.y - lInner.y);
        const blinkLeftFactor = THREE.MathUtils.clamp(1.0 - (faceEvents?.blinkLeft ?? 0) * 1.4, 0.0, 1.0);
        this.leftEyeHalo.position.set((lIris.x - 0.5) * aspect, -(lIris.y - 0.5), -lIris.z * aspect + 0.008);
        this.leftEyeHalo.scale.setScalar(Math.max(0.01, lEyeWidth * 2.15 * blinkLeftFactor));

        const rIris = landmarks[RIGHT_IRIS_CENTER];
        const rOuter = landmarks[263];
        const rInner = landmarks[362];
        const rEyeWidth = Math.hypot((rOuter.x - rInner.x) * aspect, rOuter.y - rInner.y);
        const blinkRightFactor = THREE.MathUtils.clamp(1.0 - (faceEvents?.blinkRight ?? 0) * 1.4, 0.0, 1.0);
        this.rightEyeHalo.position.set((rIris.x - 0.5) * aspect, -(rIris.y - 0.5), -rIris.z * aspect + 0.008);
        this.rightEyeHalo.scale.setScalar(Math.max(0.01, rEyeWidth * 2.15 * blinkRightFactor));

        // 4. Anillo de labios
        const lipPos = this.lipsMesh.geometry.attributes.position.array;
        const ringCount = OUTER_LIP_LOOP.length;
        for (let i = 0; i < ringCount; i++) {
            writeLandmark(lipPos, i * 3, OUTER_LIP_LOOP[i], 0.004);
            writeLandmark(lipPos, (ringCount + i) * 3, INNER_LIP_LOOP[i], 0.004);
        }
        this.lipsMesh.geometry.attributes.position.needsUpdate = true;

        // 5. Interior de boca / sonrisa
        const inPos = this.innerMouthMesh.geometry.attributes.position.array;
        const topInner = landmarks[13];
        const botInner = landmarks[14];
        inPos[0] = (((topInner.x + botInner.x) * 0.5) - 0.5) * aspect;
        inPos[1] = -(((topInner.y + botInner.y) * 0.5) - 0.5);
        inPos[2] = -((topInner.z + botInner.z) * 0.5) * aspect + 0.003;
        for (let i = 0; i < INNER_LIP_LOOP.length; i++) {
            writeLandmark(inPos, (i + 1) * 3, INNER_LIP_LOOP[i], 0.003);
        }
        this.innerMouthMesh.geometry.attributes.position.needsUpdate = true;

        // Actualizar uniforms
        const smileVal = faceEvents?.smile ?? 0;
        const jawVal = faceEvents?.jawOpen ?? 0;
        const eyeOpenAvg = (blinkLeftFactor + blinkRightFactor) * 0.5;

        this.uniforms.uGoldMix.value = goldMix;
        this.uniforms.uIntensity.value = THREE.MathUtils.lerp(0.25, 1.0, eyeOpenAvg);
        this.uniforms.uMouthBoost.value = THREE.MathUtils.clamp(0.32 + smileVal * 0.65 + jawVal * 0.45, 0.25, 1.0);
    }
}

// ============================================================================
// 4. RETICULA 3D Y CORCHETES DE RASTREO FACIAL (Anclados a la cabeza en Three.js)
// ============================================================================
class FaceReticle3D {
    constructor(rootNode) {
        this.group = new THREE.Group();
        this.group.name = "FaceReticle3D";
        this.group.visible = false;

        // En rootNode: origen = entrecejo, 1.0 = ancho mejillas, +Y = frente, +Z = hacia camara
        const segments = [];
        const addSeg = (x1, y1, z1, x2, y2, z2) => {
            segments.push(x1, y1, z1, x2, y2, z2);
        };

        const zCross = 0.24;
        const cy = -0.09; // Centro de la cruz justo en el puente de la nariz

        // --- Cruz central de precision ---
        // Linea vertical superior (frente hasta justo encima del centro)
        addSeg(0, 0.72, zCross, 0, cy + 0.048, zCross);
        // Pequeno trazo central vertical en el hueco de la cruz
        addSeg(0, cy + 0.018, zCross, 0, cy - 0.018, zCross);
        // Linea vertical inferior (debajo del centro hasta debajo del menton)
        addSeg(0, cy - 0.048, zCross, 0, -0.94, zCross);

        // Linea horizontal izquierda (exterior mejilla hasta hueco izquierdo)
        addSeg(-0.68, cy, zCross, -0.13, cy, zCross);
        // Pequeno trazo horizontal interior izquierdo
        addSeg(-0.085, cy, zCross, -0.032, cy, zCross);
        // Pequeno trazo horizontal interior derecho
        addSeg(0.032, cy, zCross, 0.085, cy, zCross);
        // Linea horizontal derecha (hueco derecho hasta exterior mejilla)
        addSeg(0.13, cy, zCross, 0.68, cy, zCross);

        // --- 4 Corchetes angulares alrededor de la cabeza ---
        const zBrk = 0.16;

        // Superior izquierdo
        addSeg(-0.30, 0.74, zBrk, -0.60, 0.74, zBrk);
        addSeg(-0.60, 0.74, zBrk, -0.82, 0.34, zBrk);

        // Superior derecho
        addSeg(0.30, 0.74, zBrk, 0.60, 0.74, zBrk);
        addSeg(0.60, 0.74, zBrk, 0.82, 0.34, zBrk);

        // Inferior izquierdo
        addSeg(-0.80, -0.46, zBrk, -0.56, -0.85, zBrk);
        addSeg(-0.56, -0.85, zBrk, -0.28, -0.85, zBrk);

        // Inferior derecho
        addSeg(0.80, -0.46, zBrk, 0.56, -0.85, zBrk);
        addSeg(0.56, -0.85, zBrk, 0.28, -0.85, zBrk);

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(segments, 3));

        this.coreMaterial = new THREE.LineBasicMaterial({
            color: 0x6dff80,
            transparent: true,
            opacity: 0.92,
            depthTest: false,
            depthWrite: false,
        });

        this.glowMaterial = new THREE.LineBasicMaterial({
            color: 0x39ff14,
            transparent: true,
            opacity: 0.34,
            blending: THREE.AdditiveBlending,
            depthTest: false,
            depthWrite: false,
        });

        this.coreLines = new THREE.LineSegments(geometry, this.coreMaterial);
        this.coreLines.renderOrder = 30;
        this.coreLines.frustumCulled = false;

        this.glowLines = new THREE.LineSegments(geometry, this.glowMaterial);
        this.glowLines.scale.set(1.007, 1.007, 1);
        this.glowLines.renderOrder = 29;
        this.glowLines.frustumCulled = false;

        this.group.add(this.glowLines, this.coreLines);
        rootNode.add(this.group);

        this._greenCore = new THREE.Color(0x78ff88);
        this._goldCore = new THREE.Color(0xffe066);
        this._greenGlow = new THREE.Color(0x28ff44);
        this._goldGlow = new THREE.Color(0xffb703);
    }

    update(visible, goldMix) {
        this.group.visible = visible;
        if (!visible) return;

        this.coreMaterial.color.copy(this._greenCore).lerp(this._goldCore, goldMix);
        this.glowMaterial.color.copy(this._greenGlow).lerp(this._goldGlow, goldMix);
    }
}

// ============================================================================
// 5. HUD TACTICO EN PANTALLA (2D sin espejo: NIGHT-BITES VISION, PWR, Brujula, GPS)
// ============================================================================
class NightVisionHUD {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.smoothedYaw = 0;
    }

    resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = this.canvas.clientWidth || window.innerWidth;
        const h = this.canvas.clientHeight || window.innerHeight;

        if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
            this.canvas.width = Math.round(w * dpr);
            this.canvas.height = Math.round(h * dpr);
        }
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return { w, h };
    }

    getPalette(goldMix) {
        const lerp = (a, b) => Math.round(a + (b - a) * goldMix);
        // Verde neon tactico (#72ff84) <-> Dorado luminoso (#ffd84d)
        const r = lerp(114, 255);
        const g = lerp(255, 216);
        const b = lerp(132, 77);

        const gr = lerp(45, 255);
        const gg = lerp(255, 185);
        const gb = lerp(75, 20);

        return {
            stroke: `rgba(${r}, ${g}, ${b}, 0.88)`,
            strokeDim: `rgba(${r}, ${g}, ${b}, 0.55)`,
            fill: `rgba(${r}, ${g}, ${b}, 0.94)`,
            glow: `rgba(${gr}, ${gg}, ${gb}, 0.72)`,
        };
    }

    render(visible, goldMix, headMatrix) {
        const { w, h } = this.resize();
        const ctx = this.ctx;
        ctx.clearRect(0, 0, w, h);

        if (!visible) return;

        // Micro-desplazamiento suave de la brujula al girar la cabeza
        let targetYaw = 0;
        if (headMatrix && headMatrix.length >= 16) {
            targetYaw = THREE.MathUtils.clamp(headMatrix[8] || 0, -0.45, 0.45);
        }
        this.smoothedYaw += (targetYaw - this.smoothedYaw) * 0.14;

        const pal = this.getPalette(goldMix);
        const isCompact = w < 600;

        const mx = isCompact ? Math.max(18, w * 0.042) : Math.max(36, w * 0.055);
        const myTop = isCompact ? Math.max(34, h * 0.055) : Math.max(40, h * 0.058);
        const myBot = isCompact ? Math.max(82, h * 0.115) : Math.max(88, h * 0.115);

        const headerFontSize = isCompact ? 15 : 19;
        const subFontSize = isCompact ? 13 : 16;
        const bottomMainSize = isCompact ? 17 : 23;
        const bottomSubSize = isCompact ? 15 : 20;

        ctx.save();
        ctx.strokeStyle = pal.stroke;
        ctx.fillStyle = pal.fill;
        ctx.shadowColor = pal.glow;
        ctx.shadowBlur = 10;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        // --------------------------------------------------------------------
        // A. ENCABEZADO SUPERIOR IZQUIERDO: "NIGHT-BITES VISION"
        // --------------------------------------------------------------------
        ctx.font = `600 ${headerFontSize}px 'Rajdhani', 'Segoe UI', sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";

        const titleText = "NIGHT-BITES VISION";
        const titleX = mx + 18;
        const titleY = myTop + 14;
        ctx.fillText(titleText, titleX, titleY);

        const titleWidth = ctx.measureText(titleText).width;
        const topLineY = myTop + 21;
        const chamferDrop = 28;
        const chamferInset = 18;

        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(titleX + titleWidth + 8, topLineY);
        ctx.lineTo(titleX, topLineY);
        ctx.lineTo(mx, topLineY + chamferDrop);

        // Borde vertical izquierdo con muescas tacticas a 45 grados
        const notch1Y = h * 0.25;
        const notch2Y = h * 0.56;
        const notchOut = isCompact ? 8 : 12;
        const botCornerY = h - myBot - 48;

        ctx.lineTo(mx, notch1Y);
        ctx.lineTo(mx - notchOut, notch1Y + 14);
        ctx.lineTo(mx - notchOut, notch2Y);
        ctx.lineTo(mx, notch2Y + 14);
        ctx.lineTo(mx, botCornerY);
        ctx.lineTo(mx + 34, h - myBot - 10);
        ctx.lineTo(mx + 74, h - myBot - 10);
        ctx.stroke();

        // --------------------------------------------------------------------
        // B. ENCABEZADO SUPERIOR DERECHO: "PWR: 95% | [BATERIA]" + "| ACTIVE"
        // --------------------------------------------------------------------
        const rightEndX = w - mx - 18;
        const batW = isCompact ? 36 : 44;
        const batH = isCompact ? 14 : 17;
        const batNubW = 3;
        const batNubH = Math.round(batH * 0.46);
        const batX = rightEndX - batW - batNubW;
        const batY = titleY - batH - 1;

        ctx.textAlign = "right";
        ctx.textBaseline = "bottom";
        const pwrText = "PWR: 95% |";
        const pwrTextX = batX - 8;
        ctx.fillText(pwrText, pwrTextX, titleY);

        const pwrWidth = ctx.measureText(pwrText).width;
        const rightBlockWidth = pwrWidth + 8 + batW + batNubW;

        // Contorno de bateria + barra de carga 95%
        ctx.lineWidth = 1.4;
        ctx.strokeRect(batX, batY, batW, batH);
        ctx.fillRect(batX + batW, batY + (batH - batNubH) / 2, batNubW, batNubH);
        const pad = 2.5;
        ctx.fillRect(batX + pad, batY + pad, (batW - pad * 2) * 0.92, batH - pad * 2);

        // Linea derecha + borde vertical derecho simetrico
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(rightEndX - rightBlockWidth - 8, topLineY);
        ctx.lineTo(rightEndX, topLineY);
        ctx.lineTo(w - mx, topLineY + chamferDrop);

        ctx.lineTo(w - mx, notch1Y);
        ctx.lineTo(w - mx + notchOut, notch1Y + 14);
        ctx.lineTo(w - mx + notchOut, notch2Y);
        ctx.lineTo(w - mx, notch2Y + 14);
        ctx.lineTo(w - mx, botCornerY);
        ctx.lineTo(w - mx - 34, h - myBot - 10);
        ctx.lineTo(w - mx - 74, h - myBot - 10);
        ctx.stroke();

        // Texto "| ACTIVE" debajo de la linea superior derecha
        ctx.font = `600 ${subFontSize}px 'Rajdhani', 'Segoe UI', sans-serif`;
        ctx.textAlign = "right";
        ctx.textBaseline = "top";
        ctx.fillText("| ACTIVE", rightEndX, topLineY + 7);

        // --------------------------------------------------------------------
        // C. ESCALA DE RUMBO / BRUJULA INFERIOR CENTRAL (50 375 310 325 50)
        // --------------------------------------------------------------------
        const cx = w * 0.5;
        const scaleSpan = isCompact ? Math.min(230, w * 0.52) : Math.min(340, w * 0.34);
        const scaleBaseY = h - myBot - 12;
        const yawShiftPx = this.smoothedYaw * 24;

        // Marcas diagonales laterales (\ y /) que enmarcan la brujula
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx - scaleSpan * 0.5 - 24, scaleBaseY - 12);
        ctx.lineTo(cx - scaleSpan * 0.5 - 12, scaleBaseY + 3);
        ctx.moveTo(cx + scaleSpan * 0.5 + 24, scaleBaseY - 12);
        ctx.lineTo(cx + scaleSpan * 0.5 + 12, scaleBaseY + 3);
        ctx.stroke();

        // Triangulo indicador central fijo apuntando hacia "310"
        const triY = scaleBaseY - 24;
        ctx.beginPath();
        ctx.moveTo(cx, triY + 6);
        ctx.lineTo(cx - 4.5, triY);
        ctx.lineTo(cx + 4.5, triY);
        ctx.closePath();
        ctx.fill();

        // Numeros y graduaciones
        const labels = ["50", "375", "310", "325", "50"];
        const step = scaleSpan / (labels.length - 1);

        ctx.font = `600 ${isCompact ? 11 : 13}px 'Rajdhani', 'Segoe UI', sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";

        for (let i = 0; i < labels.length; i++) {
            const lx = cx - scaleSpan * 0.5 + i * step + yawShiftPx;
            ctx.fillText(labels[i], lx, scaleBaseY - 7);

            // Marca mayor debajo del numero
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(lx, scaleBaseY - 4);
            ctx.lineTo(lx, scaleBaseY + 3);
            ctx.stroke();

            // 4 marcas menores entre numeros
            if (i < labels.length - 1) {
                const subStep = step / 5;
                ctx.lineWidth = 1.0;
                ctx.strokeStyle = pal.strokeDim;
                for (let m = 1; m <= 4; m++) {
                    const mxTick = lx + m * subStep;
                    ctx.beginPath();
                    ctx.moveTo(mxTick, scaleBaseY - 2);
                    ctx.lineTo(mxTick, scaleBaseY + 2);
                    ctx.stroke();
                }
                ctx.strokeStyle = pal.stroke;
            }
        }

        // --------------------------------------------------------------------
        // D. TELEMETRIA INFERIOR: BOGOTA, COLOMBIA & NIGHT VIS MODE: ON
        // --------------------------------------------------------------------
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.font = `600 ${bottomMainSize}px 'Rajdhani', 'Segoe UI', sans-serif`;
        ctx.fillText("BOGOTÁ, COLOMBIA | LAT: 4°36'N LON: 74°5'W", cx, h - myBot + 10);

        ctx.font = `600 ${bottomSubSize}px 'Rajdhani', 'Segoe UI', sans-serif`;
        ctx.fillText("NIGHT VIS MODE: ON", cx, h - myBot + 14 + bottomMainSize);

        ctx.restore();
    }
}

// ============================================================================
// 6. CONTROLADOR PRINCIPAL DEL FILTRO NIGHT-BITES VISION
// ============================================================================
export default class NightVisionFilter {
    constructor({ video, hudCanvas, player, faceRenderer, faceEvents }) {
        this.video = video;
        this.hudCanvas = hudCanvas;
        this.player = player;
        this.faceRenderer = faceRenderer;
        this.faceEvents = faceEvents;

        // Estado del filtro:
        // Inicia false (camara normal) -> cerrar los ojos activa/desactiva vision nocturna
        this.nightVision = false;
        this.goldMode = false;
        this.goldMix = 0.0; // Transicion suave 0.0 (Verde Neon) <-> 1.0 (Dorado)

        // Deteccion de cierre intencional de ojos (evita falsos disparos por parpadeo rapido)
        this.eyesClosedMs = 0;
        this.eyeToggleConsumed = false;
        this.eyeCloseThreshold = 0.48;
        this.eyeOpenThreshold = 0.30;
        this.eyeHoldDurationMs = 240;

        this.lastTime = performance.now();

        this.audio = new ShimmerAudio();
        this.videoPass = new NightVisionVideoPass(video, player);
        this.neonFeatures = new NeonFaceFeatures(video, faceRenderer.faceGroup);
        this.reticle3D = new FaceReticle3D(player.rootNode);
        this.hud = new NightVisionHUD(hudCanvas);

        this.bindEvents();
    }

    bindEvents() {
        // Detectar sonrisa mediante FaceEvents para cambiar todo a dorado
        this.faceEvents.addListener((type) => {
            if (type === "smileStart") {
                this.setGoldMode(true);
            } else if (type === "smileEnd") {
                this.setGoldMode(false);
            }
        });

        // Atajos de teclado opcionales para pruebas rapidas (N = Vision Nocturna, G = Dorado)
        window.addEventListener("keydown", (e) => {
            if (e.repeat) return;
            const key = e.key.toLowerCase();
            if (key === "n") {
                this.toggleNightVision();
            } else if (key === "g") {
                this.setGoldMode(!this.goldMode);
            }
        });
    }

    toggleNightVision(forceState = null) {
        const nextState = typeof forceState === "boolean" ? forceState : !this.nightVision;
        if (nextState === this.nightVision) return;

        this.nightVision = nextState;
        this.audio.playShimmer(this.nightVision ? "nv_on" : "nv_off");
    }

    setGoldMode(active) {
        if (this.goldMode === active) return;
        this.goldMode = active;

        if (this.nightVision) {
            this.audio.playShimmer(active ? "gold" : "green");
        }
    }

    resize() {
        this.videoPass.resize();
        this.hud.resize();
    }

    update(landmarks, detected) {
        const now = performance.now();
        const dt = Math.min(now - this.lastTime, 100);
        this.lastTime = now;

        // 1. Verificar cierre de ojos (ambos ojos cerrados sostenidos ~240ms)
        if (detected) {
            const leftClosed = (this.faceEvents.blinkLeft ?? 0) > this.eyeCloseThreshold;
            const rightClosed = (this.faceEvents.blinkRight ?? 0) > this.eyeCloseThreshold;
            const avgBlink = this.faceEvents.blink ?? 0;

            if (leftClosed && rightClosed) {
                this.eyesClosedMs += dt;
                if (!this.eyeToggleConsumed && this.eyesClosedMs >= this.eyeHoldDurationMs) {
                    this.eyeToggleConsumed = true;
                    this.toggleNightVision();
                }
            } else if (avgBlink < this.eyeOpenThreshold) {
                this.eyesClosedMs = 0;
                this.eyeToggleConsumed = false;
            }
        } else {
            this.eyesClosedMs = 0;
            this.eyeToggleConsumed = false;
        }

        // 2. Interpolacion suave Verde Neon (0) <-> Dorado (1)
        const targetGold = this.nightVision && this.goldMode ? 1.0 : 0.0;
        this.goldMix += (targetGold - this.goldMix) * 0.22;
        if (Math.abs(targetGold - this.goldMix) < 0.002) {
            this.goldMix = targetGold;
        }

        // 3. Actualizar capas 3D y HUD 2D
        const showFaceOverlays = this.nightVision && detected;

        this.videoPass.update(this.nightVision, this.goldMix, now * 0.001);
        this.neonFeatures.update(showFaceOverlays, landmarks, this.faceEvents, this.goldMix);
        this.reticle3D.update(showFaceOverlays, this.goldMix);
        this.hud.render(this.nightVision, this.goldMix, this.faceEvents.headMatrix);
    }
}
