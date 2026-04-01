// Apache Helicopter FBX Viewer with Animated Rotors
// Three.js ES Module based 3D viewer

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

// Global variables
let scene, camera, renderer, controls;
let helicopterModel = null;
let mainRotor = null;
let tailRotor = null;
let mainRotorSpeed = 0.5;
let tailRotorSpeed = 0.5;
let clock = new THREE.Clock();

// Part selection variables
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
function init() {
    // Create scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    scene.fog = new THREE.Fog(0x1a1a2e, 50, 200);

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
    controls.maxDistance = 100;
    controls.maxPolarAngle = Math.PI / 2 + 0.3;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.5;

    // Setup lighting
    setupLighting();

    // Create ground
    createGround();

    // Load the FBX model
    loadModel();

    // Setup UI controls
    setupControls();

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

// Create ground plane
function createGround() {
    const groundGeometry = new THREE.PlaneGeometry(200, 200);
    const groundMaterial = new THREE.MeshStandardMaterial({
        color: 0x3d5c3d,
        roughness: 0.9,
        metalness: 0.1
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Grid helper
    const gridHelper = new THREE.GridHelper(200, 50, 0x555555, 0x333333);
    gridHelper.position.y = -1.99;
    scene.add(gridHelper);
}

// Load FBX model
function loadModel() {
    const loader = new FBXLoader();
    
    loader.load(
        'model.fbx',
        function(object) {
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
            document.getElementById('loading').style.display = 'none';

            console.log('Model loaded successfully!');
            console.log('Model hierarchy:');
            logModelHierarchy(object);
        },
        function(progress) {
            const percent = (progress.loaded / progress.total * 100).toFixed(0);
            console.log('Loading: ' + percent + '%');
        },
        function(error) {
            console.error('Error loading model:', error);
            document.getElementById('loading').innerHTML = 
                '<p style="color: #ff6b6b;">Error loading model!</p>' +
                '<p style="font-size: 0.9rem; margin-top: 10px;">Make sure model.fbx is in the same folder as index.html</p>';
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
    
    // Mouse move for hover effect
    container.addEventListener('mousemove', onMouseMove);
    
    // Click for selection
    container.addEventListener('click', onMouseClick);
    
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
    if (!helicopterModel) return;
    
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    raycaster.setFromCamera(mouse, camera);
    
    const intersects = raycaster.intersectObject(helicopterModel, true);
    
    // Remove existing hover info
    const existingHover = document.querySelector('.hover-info');
    if (existingHover) existingHover.remove();
    
    if (intersects.length > 0) {
        const intersectedObject = getSelectableParent(intersects[0].object);
        
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
            hoverInfo.textContent = hoveredPart.name || 'Unnamed Part';
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
    let current = object;
    
    while (current) {
        // Skip the root model and scene
        if (current === helicopterModel || current === scene) {
            return null;
        }
        
        // Return if it's a mesh or group with a name
        if ((current.isMesh || current.isGroup) && current.name && current.name !== '') {
            return current;
        }
        
        current = current.parent;
    }
    
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

    // Animate main rotor (rotate around Y axis)
    if (mainRotor) {
        mainRotor.rotation.y += rotationSpeed * mainRotorSpeed * delta;
    }

    // Animate tail rotor (rotate around Z axis)
    if (tailRotor) {
        tailRotor.rotation.z += rotationSpeed * tailRotorSpeed * delta;
    }

    // Update controls
    controls.update();

    // Render scene
    renderer.render(scene, camera);
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}