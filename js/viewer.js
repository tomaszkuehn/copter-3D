// Apache Helicopter FBX Viewer with Animated Rotors
// Three.js ES Module based 3D viewer

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

// Load terrain options from terrains.txt
async function loadTerrainOptions() {
    try {
        const response = await fetch('terrains.txt');
        const text = await response.text();
        const terrains = text.trim().split('\n').filter(line => line.trim());
        
        const terrainSelect = document.getElementById('terrain-select');
        terrainSelect.innerHTML = '';
        
        terrains.forEach(terrain => {
            const option = document.createElement('option');
            option.value = terrain.trim();
            option.textContent = terrain.trim().replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
            terrainSelect.appendChild(option);
        });
        
        // Set default to first terrain
        if (terrains.length > 0) {
            terrainSelect.value = terrains[0].trim();
        }
    } catch (error) {
        console.error('Failed to load terrains.txt:', error);
    }
}

// Global variables
let scene, camera, renderer, controls;
let helicopterModel = null;
let mainRotor = null;
let tailRotor = null;
let mainRotorSpeed = 0.5;
let tailRotorSpeed = 0.5;
let clock = new THREE.Clock();
let raycaster = new THREE.Raycaster();
let mouse = new THREE.Vector2();
let selectedPart = null;
let hoveredPart = null;
let originalMaterials = new Map();
let highlightMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ff00,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide
});
let hoverMaterial = new THREE.MeshBasicMaterial({
    color: 0xffff00,
    transparent: true,
    opacity: 0.2,
    side: THREE.DoubleSide
});

// Movement variables
let velocityX = 0;
let velocityZ = 0;
let movementSpeed = 20; // units per second
let targetRotationY = 0; // Target rotation for smooth turning
let currentRotationY = 0; // Current interpolated rotation
let forwardSpeed = 0; // Current forward speed (momentum)
let turnRate = 0; // Current turning speed
const keys = {};

// New gradual control variables
let currentSpeed = 0; // Current forward/backward speed
let maxSpeed = 30; // Maximum speed
let acceleration = 15; // Acceleration rate (units per second squared)
let braking = 25; // Braking rate
let currentHeading = 0; // Current facing direction in radians
let turnVelocity = 0; // Current turning velocity
let maxTurnSpeed = 1.0; // Maximum turn rate (radians per second)
let turnAcceleration = 3.0; // How fast turning builds up

// Camera height tracking
let cameraHeightOffset = 15; // Maintain camera height above ground
let cameraAngleOffset = 0; // Maintain camera angle around the model
let lastHelicopterX = 0;
let lastHelicopterZ = 0;

// Rotor detection patterns
const mainRotorPatterns = [
    'main', 'rotor', 'blade', 'propeller', 'head', 
    'main_rotor', 'mainrotor', 'mr', 'hauptrotor'
];

const tailRotorPatterns = [
    'tail', 'rear', 'anti', 'boom', 'tr',
    'tail_rotor', 'tailrotor', 'heckrotor'
];

// Initialize the scene
function createProceduralSky() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');

    // Draw gradient sky (blue at top, lighter at horizon)
    const gradient = ctx.createLinearGradient(0, 0, 0, 1024);
    gradient.addColorStop(0, '#1e90ff');      // Deep blue at top
    gradient.addColorStop(0.3, '#4da6ff');    // Medium blue
    gradient.addColorStop(0.7, '#87ceeb');    // Sky blue
    gradient.addColorStop(1, '#e0f6ff');      // Very light at horizon

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1024, 1024);

    // Add some cloud effect with soft circles
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    for (let i = 0; i < 20; i++) {
        const x = Math.random() * 1024;
        const y = Math.random() * 500; // Only in upper part
        const radius = Math.random() * 100 + 50;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
    }

    const skyTexture = new THREE.CanvasTexture(canvas);
    skyTexture.mapping = THREE.EquirectangularReflectionMapping;
    return skyTexture;
}

function init() {
    // Create scene
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x1a1a2e, 50, 200);
    scene.background = createProceduralSky();

    // Create camera
    camera = new THREE.PerspectiveCamera(
        60,
        window.innerWidth / window.innerHeight,
        0.1,
        1000
    );
    camera.position.set(10, 8, 15);

    // Create renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;

    const container = document.getElementById('canvas-container');
    container.appendChild(renderer.domElement);

    // Add orbit controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 3;
    controls.maxDistance = 80;  // Reduced for closer follow
    controls.maxPolarAngle = Math.PI / 2 + 0.3;
    controls.autoRotate = false;  // Disable auto-rotate when following
    controls.autoRotateSpeed = 0.5;

    // Setup lighting
    setupLighting();

    // Create ground
    createGround('rocky_terrain');

    // Load the FBX model
    loadModel();

    // Setup UI controls
    setupControls();
    loadTerrainOptions();

    // Setup part selection interaction
    setupPartSelection();

    // Handle window resize
    window.addEventListener('resize', onWindowResize);

    // Start animation loop
    animate();
}

// Setup scene lighting
function setupLighting() {
    // Ambient light
    const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
    scene.add(ambientLight);

    // Main directional light (sun)
    const mainLight = new THREE.DirectionalLight(0xffffff, 1.2);
    mainLight.position.set(20, 30, 20);
    mainLight.castShadow = true;
    mainLight.shadow.mapSize.width = 2048;
    mainLight.shadow.mapSize.height = 2048;
    mainLight.shadow.camera.near = 0.5;
    mainLight.shadow.camera.far = 100;
    mainLight.shadow.camera.left = -30;
    mainLight.shadow.camera.right = 30;
    mainLight.shadow.camera.top = 30;
    mainLight.shadow.camera.bottom = -30;
    mainLight.shadow.bias = -0.0001;
    scene.add(mainLight);

    // Fill light
    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3);
    fillLight.position.set(-20, 10, -20);
    scene.add(fillLight);

    // Rim light
    const rimLight = new THREE.DirectionalLight(0xffaa00, 0.4);
    rimLight.position.set(0, 10, -30);
    scene.add(rimLight);

    // Hemisphere light for natural sky lighting
    const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x3d5c3d, 0.3);
    scene.add(hemiLight);
}

// Create ground plane with textures

function createGround(ground_name) {
    // ── Lighting ────────────────────────────────────────────────────────────
    const sunLight = new THREE.DirectionalLight(0xfff4e0, 3.0); // warm sun color
    sunLight.position.set(10, 40, 10);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width  = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far  = 500;
    sunLight.shadow.camera.left   = -2500;
    sunLight.shadow.camera.right  =  2500;
    sunLight.shadow.camera.top    =  2500;
    sunLight.shadow.camera.bottom = -2500;
    scene.add(sunLight);

    const ambientLight = new THREE.AmbientLight(0xFFFFFF, 1.0); // soft sky blue fill
    scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0xfff4c0, 0x8B7355, 1.1); // sky / ground bounce
    scene.add(hemiLight);

    // ── Textures ─────────────────────────────────────────────────────────────
    const textureLoader = new THREE.TextureLoader();

    // Handle folder and texture name mapping
    let folderName, texturePrefix;
    if (ground_name === 'aerial_rocks') {
        folderName = 'aerial_rocks_01_4k';
        texturePrefix = 'aerial_rocks_01';
    } else {
        folderName = ground_name + '_4k';
        texturePrefix = ground_name;
    }

    const diffTexture = textureLoader.load(folderName + '.blend/textures/' + texturePrefix + '_diff_4k.jpg');
    diffTexture.wrapS = THREE.RepeatWrapping;
    diffTexture.wrapT = THREE.RepeatWrapping;
    diffTexture.repeat.set(100, 100); // Increased for larger ground area
    diffTexture.colorSpace = THREE.SRGBColorSpace; // ← fix: correct color space


    const normalTexture = textureLoader.load(folderName + '.blend/textures/' + texturePrefix + '_nor_gl_4k.exr');
    normalTexture.wrapS = THREE.RepeatWrapping;
    normalTexture.wrapT = THREE.RepeatWrapping;
    normalTexture.repeat.set(100, 100); // Increased for larger ground area
    normalTexture.flipY = false; // ← fix: Blender-exported normals don't need flipping

    // ── Ground Mesh ───────────────────────────────────────────────────────────
    const groundGeometry = new THREE.CircleGeometry(2500, 128); // 5000 units diameter (radius 2500)
    const groundMaterial = new THREE.MeshStandardMaterial({
        map:         diffTexture,
        normalMap:   normalTexture,
        normalScale: new THREE.Vector2(1, 1),
        roughness:   0.6,
        metalness:   0.0
        // ← no 'color' override — let the texture speak for itself
    });

    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2;
    ground.receiveShadow = true;
    scene.add(ground);

    // ── Grid Helper ────────────────────────────────────────────────────────────
    const gridHelper = new THREE.GridHelper(5000, 100, 0xA09070, 0x807050);
    gridHelper.position.y = -2.99;
    scene.add(gridHelper);
}

// Switch terrain texture
function switchTerrain(terrainName) {
    // Find and remove existing ground plane
    const groundToRemove = scene.children.find(child =>
        child.type === 'Mesh' && child.geometry && child.geometry.type === 'PlaneGeometry'
    );
    if (groundToRemove) {
        scene.remove(groundToRemove);
    }

    // Find and remove existing grid helper
    const gridToRemove = scene.children.find(child => child.type === 'GridHelper');
    if (gridToRemove) {
        scene.remove(gridToRemove);
    }

    // Remove all lights (we'll add new ones)
    const lightsToRemove = scene.children.filter(child =>
        child.type === 'DirectionalLight' || child.type === 'AmbientLight' || child.type === 'HemisphereLight'
    );
    lightsToRemove.forEach(light => scene.remove(light));

    // Create new ground with selected texture
    createGround(terrainName);
}

// Load FBX model
function loadModel() {
    const loader = new FBXLoader();
    
    loader.load(
        'apacheFbx.fbx',
        function(object) {
            console.log('FBX model loaded successfully:', object);
            helicopterModel = object;
            
            // Enable shadows for all meshes
            object.traverse(function(child) {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    
                    // Improve material quality
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach(mat => {
                                mat.side = THREE.DoubleSide;
                            });
                        } else {
                            child.material.side = THREE.DoubleSide;
                        }
                    }
                }
            });

            // Center and scale model
            const box = new THREE.Box3().setFromObject(object);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            
            const maxDim = Math.max(size.x, size.y, size.z);
            const scale = 8 / maxDim;
            object.scale.setScalar(scale);
            
            object.position.x = -center.x * scale;
            object.position.y = -center.y * scale + 1;
            object.position.z = -center.z * scale;

            scene.add(object);

            // Detect rotors
            detectRotors(object);

            // Hide loading screen
            const loadingElement = document.getElementById('loading');
            if (loadingElement) {
                loadingElement.style.display = 'none';
            }

            console.log('Model loaded successfully!');
            console.log('Model hierarchy:');
            logModelHierarchy(object);

            console.log('Helicopter model added to scene');
        },
        function(progress) {
            console.log('FBX loading progress:', (progress.loaded / progress.total * 100) + '%');
        },
        function(error) {
            console.error('Error loading FBX model:', error);
        }
    );
}

// Detect main and tail rotors in the model
function detectRotors(model) {
    let mainRotorFound = false;
    let tailRotorFound = false;

    model.traverse(function(child) {
        if (child.isMesh || child.isGroup) {
            const name = child.name.toLowerCase();
            
            // Check for main rotor
            if (!mainRotorFound) {
                for (const pattern of mainRotorPatterns) {
                    if (name.includes(pattern)) {
                        mainRotor = child;
                        mainRotorFound = true;
                        updateStatus('main', child.name);
                        console.log('Main rotor found:', child.name);
                        break;
                    }
                }
            }
            
            // Check for tail rotor
            if (!tailRotorFound) {
                for (const pattern of tailRotorPatterns) {
                    if (name.includes(pattern)) {
                        tailRotor = child;
                        tailRotorFound = true;
                        updateStatus('tail', child.name);
                        console.log('Tail rotor found:', child.name);
                        break;
                    }
                }
            }
        }
    });

    // If not found by name, try to detect by geometry analysis
    if (!mainRotorFound || !tailRotorFound) {
        detectRotorsByGeometry(model);
    }

    // Final status update
    if (!mainRotorFound && !mainRotor) {
        document.getElementById('main-rotor-status').textContent = 'Not Found - Check Console';
        document.getElementById('main-rotor-status').style.color = '#ff6b6b';
    }
    if (!tailRotorFound && !tailRotor) {
        document.getElementById('tail-rotor-status').textContent = 'Not Found - Check Console';
        document.getElementById('tail-rotor-status').style.color = '#ff6b6b';
    }
}

// Detect rotors by analyzing geometry
function detectRotorsByGeometry(model) {
    const meshes = [];
    
    model.traverse(function(child) {
        if (child.isMesh) {
            meshes.push(child);
        }
    });

    console.log('Total meshes found:', meshes.length);
    console.log('Mesh names:', meshes.map(m => m.name));

    // Log all mesh names for debugging
    meshes.forEach((mesh, index) => {
        const box = new THREE.Box3().setFromObject(mesh);
        const size = box.getSize(new THREE.Vector3());
        console.log(`Mesh ${index}: "${mesh.name}" - Size: ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)}`);
    });
}

// Update status display
function updateStatus(type, name) {
    const element = document.getElementById(type + '-rotor-status');
    element.textContent = name;
    element.style.color = '#4fc3f7';
}

// Log model hierarchy for debugging
function logModelHierarchy(object, indent = '') {
    let info = indent + (object.name || 'unnamed');
    if (object.isMesh) info += ' [Mesh]';
    if (object.isGroup) info += ' [Group]';
    console.log(info);
    
    if (object.children) {
        object.children.forEach(child => {
            logModelHierarchy(child, indent + '  ');
        });
    }
}

// Setup UI controls
function setupControls() {
    // Main rotor speed slider
    const mainRotorSlider = document.getElementById('main-rotor-speed');
    const mainSpeedValue = document.getElementById('main-speed-value');
    
    mainRotorSlider.addEventListener('input', function() {
        mainRotorSpeed = this.value / 100;
        mainSpeedValue.textContent = this.value + '%';
    });

    // Tail rotor speed slider
    const tailRotorSlider = document.getElementById('tail-rotor-speed');
    const tailSpeedValue = document.getElementById('tail-speed-value');
    
    tailRotorSlider.addEventListener('input', function() {
        tailRotorSpeed = this.value / 100;
        tailSpeedValue.textContent = this.value + '%';
    });

    // Auto-rotate toggle
    const autoRotateCheckbox = document.getElementById('auto-rotate');
    autoRotateCheckbox.addEventListener('change', function() {
        controls.autoRotate = this.checked;
    });

    // Terrain texture selector
    const terrainSelect = document.getElementById('terrain-select');
    terrainSelect.addEventListener('change', function() {
        switchTerrain(this.value);
    });
}

// Handle window resize
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Setup part selection interaction
function setupPartSelection() {
    const container = document.getElementById('canvas-container');
    const canvas = renderer.domElement;
    
    console.log('Setting up part selection on canvas:', canvas);
    
    // Mouse move for hover effect
    canvas.addEventListener('mousemove', onMouseMove);
    
    // Click for selection
    canvas.addEventListener('click', onMouseClick);
    
    // Create part info panel
    createPartInfoPanel();
}

// Create part info panel UI
function createPartInfoPanel() {
    const panel = document.createElement('div');
    panel.id = 'part-info-panel';
    panel.innerHTML = `
        <h3>Selected Part</h3>
        <div id="part-name">Click on a part to select it</div>
        <div id="part-type"></div>
        <button id="clear-selection" style="display: none;">Clear Selection</button>
    `;
    document.body.appendChild(panel);
    
    // Add styles
    const style = document.createElement('style');
    style.textContent = `
        #part-info-panel {
            position: absolute;
            top: 20px;
            right: 20px;
            background: rgba(0, 0, 0, 0.8);
            padding: 20px;
            border-radius: 10px;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            min-width: 250px;
            color: #fff;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }
        
        #part-info-panel h3 {
            color: #4fc3f7;
            margin-bottom: 15px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.2);
            padding-bottom: 10px;
            font-size: 1.2rem;
        }
        
        #part-name {
            font-size: 1.1rem;
            color: #00ff00;
            margin-bottom: 10px;
            word-wrap: break-word;
        }
        
        #part-type {
            font-size: 0.9rem;
            color: #b0bec5;
            margin-bottom: 15px;
        }
        
        #clear-selection {
            background: linear-gradient(90deg, #4fc3f7, #00bcd4);
            border: none;
            padding: 10px 20px;
            border-radius: 5px;
            color: #fff;
            cursor: pointer;
            font-size: 0.9rem;
            width: 100%;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        
        #clear-selection:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(79, 195, 247, 0.4);
        }
        
        .hover-info {
            position: absolute;
            background: rgba(0, 0, 0, 0.9);
            color: #ffff00;
            padding: 8px 12px;
            border-radius: 5px;
            font-size: 0.85rem;
            pointer-events: none;
            z-index: 1000;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            border: 1px solid rgba(255, 255, 0, 0.3);
        }
    `;
    document.head.appendChild(style);
    
    // Clear selection button
    document.getElementById('clear-selection').addEventListener('click', clearSelection);
}

// Mouse move handler for hover effect
function onMouseMove(event) {
    if (!helicopterModel) {
        console.log('No helicopter model loaded yet');
        return;
    }
    
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    console.log('Mouse coords:', mouse.x, mouse.y, 'Event:', event.clientX, event.clientY);
    
    raycaster.setFromCamera(mouse, camera);
    
    const intersects = raycaster.intersectObject(helicopterModel, true);
    
    console.log('Mouse move - intersects found:', intersects.length);
    
    // Remove existing hover info
    const existingHover = document.querySelector('.hover-info');
    if (existingHover) existingHover.remove();
    
    if (intersects.length > 0) {
        const intersectedObject = getSelectableParent(intersects[0].object);
        
        console.log('Intersected object:', intersects[0].object.name, 'Selectable parent:', intersectedObject ? intersectedObject.name : 'none');
        
        if (intersectedObject && intersectedObject !== selectedPart) {
            // Remove previous hover highlight
            if (hoveredPart && hoveredPart !== selectedPart) {
                restoreMaterial(hoveredPart);
            }
            
            hoveredPart = intersectedObject;
            
            // Apply hover highlight if not selected
            if (hoveredPart !== selectedPart) {
                applyMaterial(hoveredPart, hoverMaterial);
            }
            
            // Show hover tooltip
            const hoverInfo = document.createElement('div');
            hoverInfo.className = 'hover-info';
            hoverInfo.textContent = hoveredPart.name || `Part (${hoveredPart.type})`;
            hoverInfo.style.left = event.clientX + 15 + 'px';
            hoverInfo.style.top = event.clientY + 15 + 'px';
            document.body.appendChild(hoverInfo);
            
            renderer.domElement.style.cursor = 'pointer';
        }
    } else {
        // Remove hover highlight
        if (hoveredPart && hoveredPart !== selectedPart) {
            restoreMaterial(hoveredPart);
            hoveredPart = null;
        }
        renderer.domElement.style.cursor = 'default';
    }
}

// Mouse click handler for selection
function onMouseClick(event) {
    if (!helicopterModel) return;
    
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    raycaster.setFromCamera(mouse, camera);
    
    const intersects = raycaster.intersectObject(helicopterModel, true);
    
    if (intersects.length > 0) {
        const intersectedObject = getSelectableParent(intersects[0].object);
        
        if (intersectedObject) {
            selectPart(intersectedObject);
        }
    }
}

// Get the selectable parent of an object
function getSelectableParent(object) {
    console.log('Getting selectable parent for:', object.name, 'type:', object.type);
    let current = object;
    
    while (current) {
        console.log('Checking object:', current.name, 'type:', current.type);
        // Skip the root model and scene
        if (current === helicopterModel || current === scene) {
            console.log('Reached root, returning null');
            return null;
        }
        
        // Return if it's a mesh (even without a name)
        if (current.isMesh) {
            console.log('Found selectable mesh:', current.name || 'unnamed');
            return current;
        }
        
        // Also return groups with names
        if (current.isGroup && current.name && current.name !== '') {
            console.log('Found selectable group:', current.name);
            return current;
        }
        
        current = current.parent;
    }
    
    console.log('No selectable parent found');
    return null;
}

// Select a part
function selectPart(part) {
    // Deselect previous part
    if (selectedPart) {
        restoreMaterial(selectedPart);
    }
    
    selectedPart = part;
    
    // Apply selection highlight
    applyMaterial(selectedPart, highlightMaterial);
    
    // Update info panel
    document.getElementById('part-name').textContent = selectedPart.name || 'Unnamed Part';
    document.getElementById('part-type').textContent = `Type: ${selectedPart.isMesh ? 'Mesh' : 'Group'}`;
    document.getElementById('clear-selection').style.display = 'block';
    
    console.log('Selected part:', selectedPart.name);
}

// Clear current selection
function clearSelection() {
    if (selectedPart) {
        restoreMaterial(selectedPart);
        selectedPart = null;
    }
    
    document.getElementById('part-name').textContent = 'Click on a part to select it';
    document.getElementById('part-type').textContent = '';
    document.getElementById('clear-selection').style.display = 'none';
}

// Apply material to an object (handles both single materials and material arrays)
function applyMaterial(object, material) {
    if (!object.isMesh) return;
    
    // Store original material if not already stored
    if (!originalMaterials.has(object)) {
        originalMaterials.set(object, object.material);
    }
    
    object.material = material;
}

// Restore original material to an object
function restoreMaterial(object) {
    if (!object.isMesh) return;
    
    if (originalMaterials.has(object)) {
        object.material = originalMaterials.get(object);
    }
}

// Animation loop
function animate() {
    requestAnimationFrame(animate);

    const delta = clock.getDelta();
    const rotationSpeed = 15; // Base rotation speed

    // Handle keyboard input for gradual movement
    const isUp = keys['ArrowUp'] || keys['w'] || keys['W'];
    const isDown = keys['ArrowDown'] || keys['s'] || keys['S'];
    const isRight = keys['ArrowLeft'] || keys['a'] || keys['A'];
    const isLeft = keys['ArrowRight'] || keys['d'] || keys['D'];

    // Gradual acceleration (Up key increases speed)
    if (isUp) {
        currentSpeed = Math.min(currentSpeed + acceleration * delta, maxSpeed);
    } else if (isDown) {
        // Down key brakes (reduces speed toward 0, then reverses)
        if (currentSpeed > 0) {
            currentSpeed = Math.max(currentSpeed - braking * delta, 0);
        } else {
            currentSpeed = Math.max(currentSpeed - acceleration * delta * 0.5, -maxSpeed * 0.5);
        }
    }

    // Gradual turning (Left/Right changes direction gradually)
    if (isLeft) {
        turnVelocity = Math.max(turnVelocity - turnAcceleration * delta, -maxTurnSpeed);
    } else if (isRight) {
        turnVelocity = Math.min(turnVelocity + turnAcceleration * delta, maxTurnSpeed);
    } else {
        // Return to center when no turn keys pressed
        if (turnVelocity > 0) {
            turnVelocity = Math.max(turnVelocity - turnAcceleration * delta * 0.5, 0);
        } else if (turnVelocity < 0) {
            turnVelocity = Math.min(turnVelocity + turnAcceleration * delta * 0.5, 0);
        }
    }

    // Apply turning to heading
    currentHeading += turnVelocity * delta;

    // Update helicopter position based on current speed and heading
    if (helicopterModel && Math.abs(currentSpeed) > 0.01) {
        // Calculate velocity based on heading and speed
        velocityX = Math.sin(currentHeading) * currentSpeed;
        velocityZ = Math.cos(currentHeading) * currentSpeed;

        helicopterModel.position.x += velocityX * delta;
        helicopterModel.position.z += velocityZ * delta;
        
        // Boundary check - keep helicopter within 2500 unit radius circle
        const distanceFromCenter = Math.sqrt(
            helicopterModel.position.x * helicopterModel.position.x + 
            helicopterModel.position.z * helicopterModel.position.z
        );
        
        if (distanceFromCenter > 2500) {
            // Clamp position to boundary
            const angle = Math.atan2(helicopterModel.position.z, helicopterModel.position.x);
            helicopterModel.position.x = Math.cos(angle) * 2500;
            helicopterModel.position.z = Math.sin(angle) * 2500;
        }
    }

    // Apply heading rotation to model even when stationary
    if (helicopterModel) {
        helicopterModel.rotation.y = currentHeading;
    }

    // Animate main rotor (rotate around Y axis)
    if (mainRotor) {
        mainRotor.rotation.y += rotationSpeed * mainRotorSpeed * delta;
    }

    // Animate tail rotor (rotate around Z axis)
    if (tailRotor) {
        tailRotor.rotation.z += rotationSpeed * tailRotorSpeed * delta;
    }

    // Camera follow the helicopter model
    if (helicopterModel) {
        // Update camera height and angle offsets if user manually changed them
        const dx = camera.position.x - helicopterModel.position.x;
        const dz = camera.position.z - helicopterModel.position.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        const angle = Math.atan2(dx, dz);

        // Update offsets if helicopter hasn't moved much (user is adjusting camera)
        //const helicopterMoved = Math.abs(helicopterModel.position.x - lastHelicopterX) > 0.1 ||
        //                       Math.abs(helicopterModel.position.z - lastHelicopterZ) > 0.1;

        cameraHeightOffset = camera.position.y - helicopterModel.position.y;

        // Update target position for OrbitControls
        controls.target.copy(helicopterModel.position);
        controls.target.y += 3; // Look slightly above the model

        // Maintain camera position relative to helicopter
        const newAngle = angle; //cameraAngleOffset;
        const newDistance = 15; //Math.max(distance, 5); // Minimum distance
        camera.position.x = helicopterModel.position.x + Math.sin(newAngle) * newDistance;
        camera.position.z = helicopterModel.position.z + Math.cos(newAngle) * newDistance;
        camera.position.y = helicopterModel.position.y + cameraHeightOffset;
        console.log('Cam X:', camera.position.x.toFixed(2), 'Cam Y:', camera.position.y.toFixed(2), 'Cam Z:', camera.position.z.toFixed(2));

        // Store last helicopter position
        lastHelicopterX = helicopterModel.position.x;
        lastHelicopterZ = helicopterModel.position.z;

        controls.update();
    }

    // Render scene
    renderer.render(scene, camera);
}

// Keyboard event handlers for movement
document.addEventListener('keydown', (event) => {
    keys[event.key] = true;
});

document.addEventListener('keyup', (event) => {
    keys[event.key] = false;
});

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}