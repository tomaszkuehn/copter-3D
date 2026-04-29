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
let maxRevSpeed = 5; // Maximum reverse speed
let acceleration = 15; // Acceleration rate (units per second squared)
let braking = 25; // Braking rate
let currentHeading = 0; // Current facing direction in radians
let turnVelocity = 0; // Current turning velocity
let maxTurnSpeed = 1.0; // Maximum turn rate (radians per second)
let turnAcceleration = 3.0; // How fast turning builds up

const sunLight = new THREE.DirectionalLight(0xfff4f4, 3.5); // warm sun color

// Camera follow state
let followOffset = new THREE.Vector3(10, 8, 15);
let lastTargetPos = new THREE.Vector3();
let isUserOrbiting = false;

// Rotor detection patterns
const mainRotorPatterns = [
    'rotor_main'
];

const tailRotorPatterns = [
    'tail_rotor'
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
    //scene.fog = new THREE.Fog(0x999999, 50, 200); //0x1a1a2e
    scene.fog = new THREE.FogExp2(0x999999, 0.01);
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
    renderer.shadowMap.type = THREE.PCFShadowMap; // Instead of PCFSoftShadowMap
    
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



    // Add this block here
    controls.addEventListener('start', () => {
        isUserOrbiting = true;
    });

    controls.addEventListener('end', () => {
        isUserOrbiting = false;
        followOffset.copy(camera.position).sub(controls.target);
    });

    // Create ground
    createGround('rocky_terrain');

    // Load the FBX model
    loadModel();

    // Setup lighting
    setupLighting();

    // Setup UI controls
    setupControls();
    loadTerrainOptions();

    // Handle window resize
    window.addEventListener('resize', onWindowResize);

    // Start animation loop
    animate();
}

// Setup scene lighting
function setupLighting() {
    // Ambient light
    const ambientLight = new THREE.AmbientLight(0xCCCCFF, 2.0);
    scene.add(ambientLight);

    //const sunLight = new THREE.DirectionalLight(0xfff4f4, 8.0); // warm sun color
    sunLight.position.set(50, 100, 10);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width  = 4096;
    sunLight.shadow.mapSize.height = 4096;
    

    sunLight.shadow.camera.left   = -100;
    sunLight.shadow.camera.right  = 100;
    sunLight.shadow.camera.top    = 100;
    sunLight.shadow.camera.bottom = -100;
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far  = 200;
    scene.add(sunLight);

    // Fill light
    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.8);
    fillLight.position.set(-20, 10, -20);
    //scene.add(fillLight);

    // Rim light
    const rimLight = new THREE.DirectionalLight(0xffaa00, 0.4);
    rimLight.position.set(0, 10, -30);
    scene.add(rimLight);

    // Hemisphere light for natural sky lighting
    const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x3d5c3d, 0.6);
    scene.add(hemiLight);
}

// Create ground plane with textures

function createGround(ground_name) {
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
    diffTexture.repeat.set(200, 200); // Increased for larger ground area
    diffTexture.colorSpace = THREE.SRGBColorSpace; // ← fix: correct color space


    // ── Ground Mesh ───────────────────────────────────────────────────────────
    const groundGeometry = new THREE.CircleGeometry(2500, 128); // 5000 units diameter (radius 2500)
    const groundMaterial = new THREE.MeshStandardMaterial({
        map:         diffTexture,
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
            helicopterModel.rotation.order = 'YXZ';
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

            // Initialize follow camera around loaded helicopter
            const initialTarget = helicopterModel.position.clone();
            initialTarget.y += 3;

            controls.target.copy(initialTarget);
            lastTargetPos.copy(initialTarget);

            // Preserve current starting camera offset, or use your default one
            followOffset.copy(camera.position).sub(controls.target);

            // If you prefer forcing a known starting chase view, use this instead:
            // camera.position.copy(controls.target).add(followOffset);

            controls.update();

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
            currentSpeed = Math.max(currentSpeed - acceleration * delta * 0.5, -maxRevSpeed * 0.5);
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
        tailRotor.rotation.x -= rotationSpeed * tailRotorSpeed * delta;
    }

    // Camera follow the helicopter model
    // Camera follow the helicopter model with constant orbit distance
    if (helicopterModel) {

        sunLight.target.position.copy(helicopterModel.position);

        sunLight.position.set(
            helicopterModel.position.x + 50,
            helicopterModel.position.y + 100,
            helicopterModel.position.z + 10
        );

        sunLight.target.updateMatrixWorld();

        if (true){ //currentSpeed > 0) {
            helicopterModel.rotation.y = currentHeading;

            const targetPitch = THREE.MathUtils.clamp(currentSpeed / maxSpeed, -1, 1) * THREE.MathUtils.degToRad(8);
            const targetRoll  = -THREE.MathUtils.clamp(turnVelocity / maxTurnSpeed, -1, 1) * THREE.MathUtils.degToRad(25);

            helicopterModel.rotation.x = THREE.MathUtils.lerp(helicopterModel.rotation.x, targetPitch, 0.08);
            helicopterModel.rotation.z = THREE.MathUtils.lerp(helicopterModel.rotation.z, targetRoll, 0.08);
        }

        const desiredTarget = helicopterModel.position.clone();
        desiredTarget.y += 3;

        // Current offset from target to camera
        const offset = camera.position.clone().sub(controls.target);

        // Preserve the user's current orbit radius
        let radius = offset.length();
        if (radius < controls.minDistance) radius = controls.minDistance;
        if (radius > controls.maxDistance) radius = controls.maxDistance;

        // Avoid zero-length offset
        if (offset.lengthSq() < 0.000001) {
            offset.set(0, 5, 15);
            radius = offset.length();
        }

        offset.normalize().multiplyScalar(radius);

        // Move target to helicopter, keep same orbit offset
        controls.target.copy(desiredTarget);
        camera.position.copy(desiredTarget).add(offset);

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

// On-screen button handlers for touch/click control
function setupMobileControls() {
    const buttons = document.querySelectorAll('.ctrl-btn');
    
    buttons.forEach(btn => {
        const key = btn.dataset.key;
        
        // Mouse events
        btn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            keys[key] = true;
            btn.classList.add('active');
        });
        
        btn.addEventListener('mouseup', (e) => {
            e.preventDefault();
            keys[key] = false;
            btn.classList.remove('active');
        });
        
        btn.addEventListener('mouseleave', (e) => {
            if (btn.classList.contains('active')) {
                keys[key] = false;
                btn.classList.remove('active');
            }
        });
        
        // Touch events for mobile
        btn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            keys[key] = true;
            btn.classList.add('active');
        }, { passive: false });
        
        btn.addEventListener('touchend', (e) => {
            e.preventDefault();
            keys[key] = false;
            btn.classList.remove('active');
        }, { passive: false });
        
        btn.addEventListener('touchcancel', (e) => {
            keys[key] = false;
            btn.classList.remove('active');
        });
    });
    
    // Handle global mouseup/touchend to release keys if cursor moves off button
    document.addEventListener('mouseup', () => {
        buttons.forEach(btn => {
            if (btn.classList.contains('active')) {
                keys[btn.dataset.key] = false;
                btn.classList.remove('active');
            }
        });
    });
    
    document.addEventListener('touchend', () => {
        buttons.forEach(btn => {
            if (btn.classList.contains('active')) {
                keys[btn.dataset.key] = false;
                btn.classList.remove('active');
            }
        });
    }, { passive: false });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        init();
        setupMobileControls();
    });
} else {
    init();
    setupMobileControls();
}