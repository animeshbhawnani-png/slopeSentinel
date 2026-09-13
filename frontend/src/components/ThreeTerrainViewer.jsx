import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * ThreeTerrainViewer
 * High-fidelity Three.js WebGL terrain mesh renderer with OrbitControls,
 * dynamic lighting, texture overlay (orthophoto or DSM), wireframe toggle,
 * and vertical exaggeration scaling.
 */
export default function ThreeTerrainViewer({
  meshUrl,
  textureUrl,
  dsmUrl,
  title = '3D Terrain Mesh',
  className = 'w-full h-full',
  autoRotate = false,
  showControls = true,
  initialWireframe = false,
  initialExaggeration = 1.0
}) {
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const terrainMeshGroupRef = useRef(null);
  const animFrameIdRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [meshStats, setMeshStats] = useState({ vertices: 0, faces: 0 });
  const [wireframe, setWireframe] = useState(initialWireframe);
  const [textureMode, setTextureMode] = useState(textureUrl ? 'source' : (dsmUrl ? 'dsm' : 'shaded'));
  const [exaggeration, setExaggeration] = useState(initialExaggeration);
  const [isRotating, setIsRotating] = useState(autoRotate);

  // Loaded texture cache
  const texturesRef = useRef({
    source: null,
    dsm: null
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !meshUrl) return;

    setLoading(true);
    setError(null);

    // 1. Scene setup
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color(0x0a1412); // Deep Himalayan slate slate

    // Atmospheric subtle fog
    scene.fog = new THREE.FogExp2(0x0a1412, 0.0025);

    // 2. Camera setup
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 500;
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.5, 2000);
    camera.position.set(0, 75, 120);
    cameraRef.current = camera;

    // 3. Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    rendererRef.current = renderer;

    // Clear previous children
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
    container.appendChild(renderer.domElement);

    // 4. OrbitControls setup
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = false;
    controls.minDistance = 10;
    controls.maxDistance = 500;
    controls.maxPolarAngle = Math.PI / 2.05; // Don't flip upside down below terrain base
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 0.7;
    controlsRef.current = controls;

    // 5. Lighting
    // Ambient light - deep pine tint
    const ambientLight = new THREE.AmbientLight(0x2d4842, 1.2);
    scene.add(ambientLight);

    // Key directional light (simulates sun from NW azimuth 315 deg)
    const sunLight = new THREE.DirectionalLight(0xfff7ed, 2.2);
    sunLight.position.set(-80, 140, -90);
    sunLight.castShadow = true;
    scene.add(sunLight);

    // Fill light (reflected valley ambient)
    const fillLight = new THREE.DirectionalLight(0x7ef6ed, 0.6);
    fillLight.position.set(60, 40, 80);
    scene.add(fillLight);

    // Subtle coordinate ground reference grid
    const grid = new THREE.GridHelper(140, 14, 0x1f3d37, 0x112421);
    grid.position.y = -0.2;
    scene.add(grid);

    // Texture loader
    const texLoader = new THREE.TextureLoader();
    if (textureUrl) {
      texLoader.load(textureUrl, (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        texturesRef.current.source = t;
        applyMaterialToGroup();
      });
    }
    if (dsmUrl) {
      texLoader.load(dsmUrl, (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        texturesRef.current.dsm = t;
        applyMaterialToGroup();
      });
    }

    // 6. OBJ Loader
    const objLoader = new OBJLoader();
    objLoader.load(
      meshUrl,
      (objGroup) => {
        let vertCount = 0;
        let faceCount = 0;

        objGroup.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;

            // Ensure smooth analytical vertex normals are active
            if (!child.geometry.attributes.normal) {
              child.geometry.computeVertexNormals();
            }

            if (child.geometry.attributes.position) {
              vertCount += child.geometry.attributes.position.count;
            }
            if (child.geometry.index) {
              faceCount += child.geometry.index.count / 3;
            } else if (child.geometry.attributes.position) {
              faceCount += child.geometry.attributes.position.count / 3;
            }
          }
        });

        // Center terrain geometry at origin (0, 0, 0)
        const box = new THREE.Box3().setFromObject(objGroup);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        objGroup.position.x = -center.x;
        objGroup.position.y = -box.min.y; // Sit flat on ground plane
        objGroup.position.z = -center.z;

        // Position camera nicely to frame the terrain
        const maxDim = Math.max(size.x, size.z, 50);
        camera.position.set(0, maxDim * 0.75, maxDim * 1.15);
        camera.lookAt(0, maxDim * 0.15, 0);
        controls.target.set(0, maxDim * 0.12, 0);
        controls.update();

        scene.add(objGroup);
        terrainMeshGroupRef.current = objGroup;

        setMeshStats({
          vertices: Math.round(vertCount),
          faces: Math.round(faceCount)
        });

        setLoading(false);
        applyMaterialToGroup();
      },
      undefined,
      (err) => {
        console.error('ThreeTerrainViewer: Failed to load OBJ mesh:', err);
        setError('Failed to parse or load 3D terrain OBJ mesh.');
        setLoading(false);
      }
    );

    // Render loop
    const animate = () => {
      animFrameIdRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Window resize handler
    const handleResize = () => {
      if (!container || !renderer || !camera) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
      if (terrainMeshGroupRef.current) {
        scene.remove(terrainMeshGroupRef.current);
      }
      renderer.dispose();
      controls.dispose();
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
    };
  }, [meshUrl]);

  // Apply material texture, wireframe, or elevation shading whenever settings change
  const applyMaterialToGroup = () => {
    const group = terrainMeshGroupRef.current;
    if (!group) return;

    let activeMap = null;
    if (textureMode === 'source' && texturesRef.current.source) {
      activeMap = texturesRef.current.source;
    } else if (textureMode === 'dsm' && texturesRef.current.dsm) {
      activeMap = texturesRef.current.dsm;
    }

    group.traverse((child) => {
      if (child.isMesh) {
        if (activeMap) {
          child.material = new THREE.MeshStandardMaterial({
            map: activeMap,
            wireframe: wireframe,
            roughness: 0.85,
            metalness: 0.05,
            side: THREE.DoubleSide
          });
        } else {
          // Alpine hypsometric tint / shaded relief
          child.material = new THREE.MeshStandardMaterial({
            color: 0x487a6d,
            wireframe: wireframe,
            roughness: 0.75,
            metalness: 0.1,
            side: THREE.DoubleSide
          });
        }
      }
    });
  };

  useEffect(() => {
    applyMaterialToGroup();
  }, [wireframe, textureMode]);

  // Handle vertical exaggeration scaling
  useEffect(() => {
    const group = terrainMeshGroupRef.current;
    if (group) {
      group.scale.y = exaggeration;
    }
  }, [exaggeration]);

  // Toggle auto rotation
  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.autoRotate = isRotating;
    }
  }, [isRotating]);

  const handleResetCamera = () => {
    if (cameraRef.current && controlsRef.current) {
      cameraRef.current.position.set(0, 75, 120);
      controlsRef.current.target.set(0, 8, 0);
      controlsRef.current.update();
      setExaggeration(1.0);
    }
  };

  return (
    <div className={`relative bg-surface-container-lowest overflow-hidden select-none flex flex-col ${className}`}>
      {/* 3D WebGL Canvas Container */}
      <div ref={containerRef} className="w-full h-full min-h-[300px] cursor-grab active:cursor-grabbing" />

      {/* Loading Overlay */}
      {loading && (
        <div className="absolute inset-0 bg-surface-container-lowest/80 backdrop-blur-sm flex flex-col items-center justify-center gap-2 z-20">
          <span className="material-symbols-outlined text-[32px] text-primary animate-spin">sync</span>
          <span className="font-label-md text-label-md text-on-surface font-semibold uppercase tracking-wider">
            Compiling 3D Terrain Mesh...
          </span>
          <span className="font-label-sm text-[11px] text-on-surface-variant font-mono">
            Wavefront OBJ • Three.js WebGL
          </span>
        </div>
      )}

      {/* Error Overlay */}
      {error && (
        <div className="absolute inset-0 bg-surface-container-lowest/90 flex flex-col items-center justify-center gap-2 z-20 text-error p-4 text-center">
          <span className="material-symbols-outlined text-[36px]">error</span>
          <span className="font-label-md text-label-md font-semibold">{error}</span>
          <span className="font-body-sm text-[11px] text-on-surface-variant">
            Please verify the reconstruction generated a valid .obj mesh file.
          </span>
        </div>
      )}

      {/* Floating HUD Controls Bar */}
      {showControls && (
        <div className="absolute top-2 right-2 flex flex-wrap items-center gap-1.5 z-10 p-1 rounded-lg bg-surface-container-lowest/85 backdrop-blur-md border border-outline-variant/40 shadow-lg">
          {/* Texture Mode Selector */}
          <div className="flex items-center gap-0.5 bg-surface-container-high rounded p-0.5">
            {textureUrl && (
              <button
                onClick={() => setTextureMode('source')}
                className={`px-2 py-0.5 rounded text-[10px] font-label-sm font-semibold transition-colors ${
                  textureMode === 'source' ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-on-surface'
                }`}
                title="Overlay source remote sensing orthophoto texture"
              >
                Orthophoto
              </button>
            )}
            {dsmUrl && (
              <button
                onClick={() => setTextureMode('dsm')}
                className={`px-2 py-0.5 rounded text-[10px] font-label-sm font-semibold transition-colors ${
                  textureMode === 'dsm' ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-on-surface'
                }`}
                title="Overlay DSM hillshade hypsometric tint texture"
              >
                DSM
              </button>
            )}
            <button
              onClick={() => setTextureMode('shaded')}
              className={`px-2 py-0.5 rounded text-[10px] font-label-sm font-semibold transition-colors ${
                textureMode === 'shaded' ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-on-surface'
              }`}
              title="Shaded relief surface"
            >
              Relief
            </button>
          </div>

          {/* Wireframe Toggle */}
          <button
            onClick={() => setWireframe(!wireframe)}
            className={`px-2 py-1 rounded text-[10px] font-label-sm flex items-center gap-1 transition-colors border ${
              wireframe
                ? 'bg-secondary-container text-primary border-primary/40'
                : 'bg-surface-container text-on-surface-variant border-outline-variant/30 hover:text-on-surface'
            }`}
            title="Toggle DEM wireframe mesh"
          >
            <span className="material-symbols-outlined text-[13px]">grid_3x3</span>
            <span>Wireframe</span>
          </button>

          {/* Vertical Exaggeration Toggle */}
          <button
            onClick={() => setExaggeration((prev) => (prev === 1.0 ? 1.5 : prev === 1.5 ? 2.0 : 1.0))}
            className="px-2 py-1 rounded bg-surface-container hover:bg-surface-container-high text-on-surface font-label-sm text-[10px] border border-outline-variant/30 transition-colors"
            title="Cycle vertical relief exaggeration (1x, 1.5x, 2x)"
          >
            Z: {exaggeration}x
          </button>

          {/* Auto-Rotate Toggle */}
          <button
            onClick={() => setIsRotating(!isRotating)}
            className={`p-1 rounded text-[10px] font-label-sm flex items-center transition-colors border ${
              isRotating
                ? 'bg-secondary-container text-primary border-primary/40'
                : 'bg-surface-container text-on-surface-variant border-outline-variant/30 hover:text-on-surface'
            }`}
            title="Toggle auto orbit rotation"
          >
            <span className={`material-symbols-outlined text-[15px] ${isRotating ? 'animate-spin' : ''}`}>
              rotate_right
            </span>
          </button>

          {/* Reset View */}
          <button
            onClick={handleResetCamera}
            className="p-1 rounded bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface border border-outline-variant/30 transition-colors"
            title="Reset 3D camera position"
          >
            <span className="material-symbols-outlined text-[15px]">center_focus_strong</span>
          </button>
        </div>
      )}

      {/* Bottom Telemetry Bar */}
      <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between text-[10px] font-label-sm text-outline px-2.5 py-1 rounded bg-surface-container-lowest/80 backdrop-blur-sm border border-outline-variant/30 pointer-events-none">
        <div className="flex items-center gap-2">
          <span className="text-secondary font-semibold uppercase">{title}</span>
          <span>•</span>
          <span className="text-on-surface-variant">
            {meshStats.vertices > 0 ? `${meshStats.vertices.toLocaleString()} vertices` : '10,000 vertices'}
          </span>
          <span>•</span>
          <span className="text-on-surface-variant font-mono">
            {meshStats.faces > 0 ? `${meshStats.faces.toLocaleString()} faces` : 'TIN quads'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline text-[9px] text-tertiary-fixed-dim">
            Left click: Orbit • Right click: Pan • Scroll: Zoom
          </span>
          <span className="px-1.5 py-0.5 rounded bg-surface-container text-primary text-[9px] font-mono">
            WebGL Three.js
          </span>
        </div>
      </div>
    </div>
  );
}
