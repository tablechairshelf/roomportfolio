import './style.scss'
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import gsap from 'gsap';

const canvas = document.querySelector("#experience-canvas");
const sizes = {
  width: window.innerWidth,
  height: window.innerHeight
}

const raycasterObjects = [];
let intersects = [];
let currentHoveredObject = null;

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

//laoders

//ModelLoaders
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('/draco/');

const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);

//Scene setup
loader.load('/models/RoomPortfoliov76-v1.glb', (glb) => {
  // Collect interactable objects — prefer mesh descendants; create colliders for groups without meshes
  glb.scene.traverse((child) => {
    if (!child.name) return;

    const hasRayTag = child.name.includes("Raycaster");
    const hasHoverTag = child.name.includes("Hover");
    if (!hasRayTag && !hasHoverTag) return;

    // find a mesh descendant to use for raycasting
    let targetMesh = null;
    if (child.isMesh) targetMesh = child;
    else {
      child.traverse((c) => {
        if (!targetMesh && c.isMesh) targetMesh = c;
      });
    }

    if (targetMesh) {
      if (hasRayTag) {
        raycasterObjects.push(targetMesh);
        // keep reference to the tagged parent so we can animate the whole object
        targetMesh.userData.sourceObject = child;
      }
      if (hasHoverTag) {
        // store hover initial state on the tagged object (group or mesh)
        child.userData.initialScale = new THREE.Vector3().copy(child.scale);
        child.userData.initialPosition = new THREE.Vector3().copy(child.position);
        child.userData.initialRotation = new THREE.Euler().copy(child.rotation);
      }
      return;
    }

    // No mesh descendant: create an invisible collider box and parent it to the tagged object
    const box = new THREE.Box3().setFromObject(child);
    const size = new THREE.Vector3();
    box.getSize(size);
    if (size.x === 0 && size.y === 0 && size.z === 0) {
      console.warn('Tagged object has no mesh and zero bounds:', child.name);
      return;
    }

    const geom = new THREE.BoxGeometry(Math.max(size.x, 0.01), Math.max(size.y, 0.01), Math.max(size.z, 0.01));
    const mat = new THREE.MeshBasicMaterial({ visible: false });
    const collider = new THREE.Mesh(geom, mat);
    collider.name = child.name + '_collider';

    // compute collider position relative to the child
    const centerWorld = new THREE.Vector3();
    box.getCenter(centerWorld);
    child.worldToLocal(centerWorld);
    collider.position.copy(centerWorld);
    // add collider as a child so transforms match and scaling the source will show visually
    child.add(collider);

    // attach reference so we can animate the original object
    collider.userData.sourceObject = child;

    if (hasRayTag) raycasterObjects.push(collider);
    if (hasHoverTag) {
      // store hover state on the source object (the visible group)
      child.userData.initialScale = new THREE.Vector3().copy(child.scale);
      child.userData.initialPosition = new THREE.Vector3().copy(child.position);
      child.userData.initialRotation = new THREE.Euler().copy(child.rotation);
    }
  });
  const model = glb.scene;
  // ensure meshes cast/receive shadows and improve PBR material defaults
  model.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      const mat = child.material;
      if (mat) {
        if (mat.isMeshStandardMaterial) {
          mat.roughness = Math.min(mat.roughness !== undefined ? mat.roughness : 0.6, 0.9);
          mat.metalness = mat.metalness !== undefined ? mat.metalness : 0.0;
          mat.envMapIntensity = Math.max(mat.envMapIntensity !== undefined ? mat.envMapIntensity : 0.9, 1.1);
        }
        // desaturate base color and emissive slightly to reduce saturation
        const SATURATION_FACTOR = 0.72; // 1.0 = unchanged, <1 reduces saturation
        if (mat.color && mat.color.isColor) {
          const hsl = { h: 0, s: 0, l: 0 };
          mat.color.getHSL(hsl);
          hsl.s = Math.max(0, hsl.s * SATURATION_FACTOR);
          mat.color.setHSL(hsl.h, hsl.s, hsl.l);
        }
        if (mat.emissive && mat.emissive.isColor) {
          const ehsl = { h: 0, s: 0, l: 0 };
          mat.emissive.getHSL(ehsl);
          ehsl.s = Math.max(0, ehsl.s * SATURATION_FACTOR);
          mat.emissive.setHSL(ehsl.h, ehsl.s, ehsl.l);
          if (mat.emissiveIntensity !== undefined) mat.emissiveIntensity *= 0.85;
        }
        mat.needsUpdate = true;
      }
    }
  });
  scene.add(model);

  // Debug: list objects that include the Raycaster/Hover tags and report their type
  console.groupCollapsed('Raycaster/hover debug');
  glb.scene.traverse((child) => {
    if (child.name && (child.name.includes('Raycaster') || child.name.includes('Hover'))) {
      console.log(
        'Candidate:',
        child.name,
        '| isMesh=', !!child.isMesh,
        '| visible=', !!child.visible,
        '| hasGeometry=', !!child.geometry,
        '| type=', child.type
      );
    }
  });
  console.groupEnd();

}, undefined, (error) => {
  console.error(error);
});



const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(15, sizes.width / sizes.height, 0.1, 1000);

const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
renderer.setSize(sizes.width, sizes.height);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.9;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const geometry = new THREE.BoxGeometry( 1, 1, 1 );
const material = new THREE.MeshStandardMaterial( { color: 0x00ff00 } );
const cube = new THREE.Mesh( geometry, material );
cube.visible = false;
scene.add( cube );

camera.position.set(63.62454109231168, 33.2129769398866, -62.89801589286664);



// Environment-like ambient using hemisphere light
const hemiLight = new THREE.HemisphereLight(0xddeeff, 0x444433, 1.6);
scene.add(hemiLight);

// subtle ambient to lift overall brightness
// keep modest to preserve strong shadows from the key light
const ambientLight = new THREE.AmbientLight(0xffffff, 0.18);
scene.add(ambientLight);

// Key directional light (acts like sun)
const dirLight = new THREE.DirectionalLight(0xffffff, 4.2);
dirLight.position.set(5, 10, 5);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 4096;
dirLight.shadow.mapSize.height = 4096;
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 50;
dirLight.shadow.camera.left = -10;
dirLight.shadow.camera.right = 10;
dirLight.shadow.camera.top = 10;
dirLight.shadow.camera.bottom = -10;
dirLight.shadow.bias = -0.0004;
dirLight.shadow.radius = 3;
scene.add(dirLight);

// Fill light to soften shadows
const fillLight = new THREE.PointLight(0xffffff, 2.2);
fillLight.position.set(-3, 2, -3);
scene.add(fillLight);

// Rim/back light to add separation
const rimLight = new THREE.DirectionalLight(0xffffff, 1.8);
(rimLight).position.set(-6, 4, -6);
scene.add(rimLight);

scene.background = new THREE.Color(0xf7f7f7);

// Add a shadow-catching ground plane
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(30, 30),
  new THREE.ShadowMaterial({ opacity: 0.72 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.001;
ground.receiveShadow = true;
scene.add(ground);

const controls = new OrbitControls( camera, renderer.domElement );
controls.minPolarAngle = 0;
controls.maxPolarAngle = Math.PI / 2;
controls.minAzimuthAngle = Math.PI/2 ;
controls.maxAzimuthAngle = Math.PI ;
controls.minDistance = 0;
controls.maxDistance = 100;

controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.update();
controls.target.set(0.7950616105872242, 7.29884438592324, 1.1933200399271437);

//Event listeners for resizing the canvas
window.addEventListener('resize', () => {
  sizes.width = window.innerWidth;
  sizes.height = window.innerHeight;

  camera.aspect = sizes.width / sizes.height;
  camera.updateProjectionMatrix();

  renderer.setSize(sizes.width, sizes.height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

window.addEventListener("mousemove", (e) => {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = - (e.clientY / window.innerHeight) * 2 + 1;
});

function playHoverAnimation (object, isHovering) {
  gsap.killTweensOf(object.scale);
  gsap.killTweensOf(object.position);

  if(isHovering) {
    gsap.to(object.scale, {
      x: object.userData.initialScale.x * 1.1,
      y: object.userData.initialScale.y * 1.1,
      z: object.userData.initialScale.z * 1.1,
      duration: 0.5,
      ease: "bounce.out",
    
    });
    if(object.name && object.name.includes("XAxis")) {
      gsap.to(object.position, {
      // x: object.userData.initialPosition.x * 1.1,
      // y: object.userData.initialPosition.y * 1.1,
      x: object.userData.initialPosition.x + .25,
      duration: 0.5,
      ease: "bounce.out",
    
    });
    } else if (object.name && object.name.includes("ZAxis")) {
      gsap.to(object.position, {
      // x: object.userData.initialPosition.x * 1.1,
      // y: object.userData.initialPosition.y * 1.1,
      z: object.userData.initialPosition.z - .25,
      duration: 0.5,
      ease: "bounce.out",
    
    });
    } else {
      gsap.to(object.position, {
      // x: object.userData.initialPosition.x * 1.1,
      // y: object.userData.initialPosition.y * 1.1,
      y: object.userData.initialPosition.y + .25,
      duration: 0.5,
      ease: "bounce.out",
    
    });
    }

  } else {
    gsap.to(object.scale, {
      x: object.userData.initialScale.x,
      y: object.userData.initialScale.y,
      z: object.userData.initialScale.z,
      duration: 0.3,
      ease: "bounce.out",
    
    });
    gsap.to(object.position, {
      x: object.userData.initialPosition.x,
      z: object.userData.initialPosition.z,
      y: object.userData.initialPosition.y,
      duration: 0.3,
      ease: "bounce.out",
    
    });
    
  }
}

const render = () => {
  controls.update();

  // console.log(camera.position);
  // console.log("-----");
  // console.log(controls.target);

  raycaster.setFromCamera(pointer, camera);

  intersects = raycaster.intersectObjects(raycasterObjects);

  for (let i = 0; i < intersects.length; i++) {
  }

  if(intersects.length>0){
    let picked = intersects[0].object;
    // if collider references a source object, animate the source (visible) object
    const target = picked.userData && picked.userData.sourceObject ? picked.userData.sourceObject : picked;

    // determine if target supports hover (has initial data) or is tagged
    const isHoverable = !!(target.userData && target.userData.initialScale) || (target.name && target.name.includes("Hover"));

    if (isHoverable) {
      if (target !== currentHoveredObject) {
        if (currentHoveredObject) playHoverAnimation(currentHoveredObject, false);
        playHoverAnimation(target, true);
        currentHoveredObject = target;
      }
      document.body.style.cursor = 'pointer';
    } else {
      document.body.style.cursor = 'default';
    }
  } else {
    if(currentHoveredObject){
          // If we're zoomed into this object, keep its hovered transform pinned
          if (!(isZoomed && currentHoveredObject === currentZoomTarget)) {
            playHoverAnimation(currentHoveredObject, false);
            currentHoveredObject = null;
          }
        }
    document.body.style.cursor = 'default';
  }



  renderer.render(scene, camera);
  window.requestAnimationFrame(render);
};

render();

// store initial camera / target for exit
const _initialCameraPos = camera.position.clone();
const _initialTarget = controls.target.clone();
let isZoomed = false;
let currentZoomTarget = null;
// Per-object camera & control presets (provided coordinates)
const presets = {
  "MusicDisplay_Raycaster_Hover": {
    camera: { x: -1.8711712954293946, y: 7.710663262695589, z: -3.117653399503058 },
    target: { x: -3.4967646308740186, y: 7.204757316970336, z: -3.117653399503058 }
  },
  "ArtworkDisplay_Raycaster_Hover": {
    camera: { x: 0.5513610015783827, y: 9.895408749742373, z: 1.995070979802167 },
    target: { x: -4.168737624469448, y: 6.778864855382751, z: 1.9950709798021669 }
  },
  "ComputerProjectsDisplay1_Raycaster_Hover": {
    camera: { x: -1.8717565344898017, y: 9.65190566717117, z: -1.7560347008682662 },
    target: { x: -1.8717565344898035, y: 4.643781648744748, z: 12.928502490075244 }
  },
  "ComputerDisplay2_Raycaster_Hover": {
    camera: { x: 0.6536377739623092, y: 9.530763510657653, z: -7.2193363420149295 },
    target: { x: 0.5444317598678033, y: 8.388037643261459, z: 1.530649723691309 }
  }
};

// create a simple exit button (hidden until zoomed)
function createExitButton() {
  const btn = document.createElement('button');
  btn.id = 'zoom-exit-btn';
  btn.textContent = 'Exit';
  Object.assign(btn.style, {
    position: 'fixed',
    right: '20px',
    top: '20px',
    padding: '10px 14px',
    fontSize: '14px',
    zIndex: 9999,
    display: 'none',
    cursor: 'pointer',
    background: 'rgba(0,0,0,0.6)',
    color: '#fff',
    border: 'none',
    borderRadius: '6px'
  });
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    exitZoom();
  });
  document.body.appendChild(btn);
}
createExitButton();

function zoomToObject(sourceObject) {
  if (!sourceObject || isZoomed) return;
  isZoomed = true;
  currentZoomTarget = sourceObject;

  // compute target center and size
  const box = new THREE.Box3().setFromObject(sourceObject);
  const sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);
  const center = sphere.center.clone();
  const radius = Math.max(sphere.radius, 0.05);

  // compute distance so object roughly fills the view
  const fov = camera.fov * (Math.PI / 180);
  const distanceByFov = radius / Math.sin(fov / 2);
  const distance = Math.max(distanceByFov * 1.08, radius * 2.5);

  // compute camera direction from center
  let dir = camera.position.clone().sub(center);
  if (dir.length() < 0.0001) dir = new THREE.Vector3(0, 0, 1);
  dir.normalize();

  const newCamPos = center.clone().add(dir.multiplyScalar(distance));

  // disable controls during animated zoom
  controls.enabled = false;

  gsap.killTweensOf(camera.position);
  gsap.killTweensOf(controls.target);

  gsap.to(camera.position, {
    x: newCamPos.x,
    y: newCamPos.y,
    z: newCamPos.z,
    duration: 1.1,
    ease: 'power2.inOut',
    onUpdate: () => {
      camera.updateProjectionMatrix();
    }
  });

  gsap.to(controls.target, {
    x: center.x,
    y: center.y,
    z: center.z,
    duration: 1.1,
    ease: 'power2.inOut',
    onUpdate: () => controls.update(),
    onComplete: () => {
      const btn = document.getElementById('zoom-exit-btn');
      if (btn) btn.style.display = 'block';
    }
  });
}

function zoomToPreset(preset) {
  if (!preset || isZoomed) return;
  isZoomed = true;
  controls.enabled = false;

  gsap.killTweensOf(camera.position);
  gsap.killTweensOf(controls.target);

  gsap.to(camera.position, {
    x: preset.camera.x,
    y: preset.camera.y,
    z: preset.camera.z,
    duration: 1.1,
    ease: 'power2.inOut',
    onUpdate: () => camera.updateProjectionMatrix()
  });

  gsap.to(controls.target, {
    x: preset.target.x,
    y: preset.target.y,
    z: preset.target.z,
    duration: 1.1,
    ease: 'power2.inOut',
    onUpdate: () => controls.update(),
    onComplete: () => {
      const btn = document.getElementById('zoom-exit-btn');
      if (btn) btn.style.display = 'block';
    }
  });
}


function exitZoom() {
  if (!isZoomed) return;
  const btn = document.getElementById('zoom-exit-btn');
  if (btn) btn.style.display = 'none';

  gsap.killTweensOf(camera.position);
  gsap.killTweensOf(controls.target);

  gsap.to(camera.position, {
    x: _initialCameraPos.x,
    y: _initialCameraPos.y,
    z: _initialCameraPos.z,
    duration: 1.1,
    ease: 'power2.inOut',
    onUpdate: () => camera.updateProjectionMatrix()
  });

  gsap.to(controls.target, {
    x: _initialTarget.x,
    y: _initialTarget.y,
    z: _initialTarget.z,
    duration: 1.1,
    ease: 'power2.inOut',
    onUpdate: () => controls.update(),
    onComplete: () => {
      controls.enabled = true;
      // if we pinned hover on the zoomed object, revert it unless pointer is still over it
      if (currentZoomTarget && currentHoveredObject !== currentZoomTarget) {
        try { playHoverAnimation(currentZoomTarget, false); } catch (e) {}
      }
      isZoomed = false;
      currentZoomTarget = null;
    }
  });
}

// click handler to zoom into the 4 specific named items
window.addEventListener('click', (e) => {
  // ignore clicks on the UI elements
  if (e.target && e.target.id === 'zoom-exit-btn') return;
  if (isZoomed) return;

  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(raycasterObjects);
  if (!hits || hits.length === 0) return;
  const picked = hits[0].object;
  const source = picked.userData && picked.userData.sourceObject ? picked.userData.sourceObject : picked;
  if (!source || !source.name) return;

  const preset = presets[source.name];
  // mark which object is currently zoom-targeted so hover can be pinned
  currentZoomTarget = source;
  // ensure hovered transform is applied and preserved
  if (source.userData && source.userData.initialScale) {
    currentHoveredObject = source;
    playHoverAnimation(source, true);
  }

  if (preset) {
    zoomToPreset(preset);
    return;
  }
  // fallback: if a non-preset object but still tagged, try auto-zoom
  if (source.userData && source.userData.initialScale) {
    zoomToObject(source);
  }
});

//pick up video from start of draco