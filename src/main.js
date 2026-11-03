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
// true while the intro modal is up; blocks hover, clicks, and orbiting
let introActive = true;
// floating labels above clickable objects: { el, anchor (world-space Vector3) }
const portfolioTags = [];
const tagLayer = document.getElementById('portfolio-tags');
const _tagProj = new THREE.Vector3();

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
  createPortfolioTags(model);

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

scene.background = new THREE.Color(0x292929);

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
// stays disabled until the intro modal is dismissed
controls.enabled = false;

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

let renderAnimId = null;
function pauseRendering() {
  try {
    if (renderAnimId !== null) cancelAnimationFrame(renderAnimId);
  } catch (e) {}
  renderAnimId = null;
  // lower pixel ratio while modal is open to reduce GPU cost
  try { renderer.setPixelRatio(1); } catch (e) {}
}

function resumeRendering() {
  // restore pixel ratio and restart loop
  try { renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); } catch (e) {}
  if (renderAnimId === null) render();
}

const render = () => {
  controls.update();

  // console.log(camera.position);
  // console.log("-----");
  // console.log(controls.target);

  raycaster.setFromCamera(pointer, camera);

  intersects = introActive ? [] : raycaster.intersectObjects(raycasterObjects);

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



  updatePortfolioTags();

  renderer.render(scene, camera);
  renderAnimId = window.requestAnimationFrame(render);
};

// build one label per entry in tagLabels, anchored just above the object's bounding box
function createPortfolioTags(root) {
  if (!tagLayer) return;
  root.updateMatrixWorld(true);
  Object.entries(tagLabels).forEach(([name, label]) => {
    const obj = root.getObjectByName(name);
    if (!obj) { console.warn('No object found for tag:', name); return; }
    const box = new THREE.Box3().setFromObject(obj);
    const anchor = new THREE.Vector3();
    box.getCenter(anchor);
    anchor.y = box.max.y + TAG_HEIGHT_OFFSET;

    const el = document.createElement('div');
    el.className = 'portfolio-tag';
    el.innerHTML = `<span class="portfolio-tag-label"></span>`;
    el.firstChild.textContent = label;
    tagLayer.appendChild(el);
    portfolioTags.push({ el, anchor });
  });
}

// project each anchor to screen space so the labels always face the camera
function updatePortfolioTags() {
  // controls.update() moved the camera, but its view matrix is only refreshed inside
  // renderer.render(); refresh it now so tags use this frame's camera, not last frame's
  camera.updateMatrixWorld();
  for (const tag of portfolioTags) {
    _tagProj.copy(tag.anchor).project(camera);
    // z > 1 means the point is behind the camera
    if (_tagProj.z > 1) { tag.el.style.display = 'none'; continue; }
    const x = (_tagProj.x * 0.5 + 0.5) * sizes.width;
    const y = (-_tagProj.y * 0.5 + 0.5) * sizes.height;
    tag.el.style.display = '';
    tag.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
  }
}

function setTagsVisible(visible) {
  if (tagLayer) tagLayer.classList.toggle('tags-hidden', !visible);
}

render();

// store initial camera / target for exit
const _initialCameraPos = camera.position.clone();
const _initialTarget = controls.target.clone();
let isZoomed = false;
let currentZoomTarget = null;
let isZooming = false;
let isModalOpen = false;
// text shown in the floating tag above each clickable object
const tagLabels = {
  "MusicDisplay_Raycaster_Hover": "Music",
  "ArtworkDisplay_Raycaster_Hover": "Artwork",
  "ComputerProjectsDisplay1_Raycaster_Hover": "Computer Projects",
  "ComputerDisplay2_Raycaster_Hover": "Engineering Projects"
};
// world-space gap between the top of an object and its tag
const TAG_HEIGHT_OFFSET = 0.3;
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

// per-object HTML content store (can include links/images/HTML). Edit these strings in code.
const userContents = {
  "MusicDisplay_Raycaster_Hover": `
    <h1>Music Works</h1>
    <p>This is a collection of music projects that I have worked on over the years. It includes original compositions. Music will be soon available for listening on this website!</p>
  `,
  "ArtworkDisplay_Raycaster_Hover": `
    <h1>Art Pieces</h1>
    <p>This is a collection of digital and physical artworks, or anything artistry related (not including music) Mainly art pieces that I have done over the years.</p>
    <p><img src="/images/Artwork/PW.JPG" alt="Artwork" style="max-width:100%;height:auto;border-radius:6px;border-width:10px;border-color:black;border-style:solid"></p>
  `,
};

// Grid-style sections: each project is a card in the modal; clicking a card opens its detail view.
// To add a project, append another object to `projects`. Swap `thumbnail` / `images` for real files
// in /public/images/Projects/. `links` takes { label, url } entries, e.g. { label: 'GitHub', url: 'https://...' }.
const PROJECT_PLACEHOLDER = '/images/Projects/placeholder.svg';
const projectSections = {
  "ComputerProjectsDisplay1_Raycaster_Hover": {
    title: 'Computer and Website Projects',
    intro: 'A collection of websites and software projects I have built. Click a project to learn more.',
    projects: [
      {
        title: '3D Room Portfolio',
        thumbnail: PROJECT_PLACEHOLDER,
        summary: 'This website! An explorable 3D room that holds my portfolio.',
        images: [PROJECT_PLACEHOLDER],
        links: [],
        details: `
          <p>The main project I have worked on is this 3D portfolio website. This website is a 3D experience in which the user is able to explore a room that contains different sections of my portfolio. Each section is represented by a 3D object that the user can click on to zoom in and learn more about that section. The sections include music projects, artwork, computer and engineering projects, and other projects. Each section has a modal that contains more information about that section as well as links to external websites. The purpose of this project is to showcase my skills in 3D modeling and web development. I plan to continue to iterate on this project and add more features such as ambient music, more interactivity, and more sections to showcase.</p>
        `
      },
      {
        title: 'CastaBookings',
        thumbnail: PROJECT_PLACEHOLDER,
        summary: 'A SaaS booking platform for scheduling appointments at local businesses.',
        images: [PROJECT_PLACEHOLDER],
        links: [],
        details: `
          <p>A smart booking platform for managing and scheduling appointments for many different businesseswith ease, made as an saas application fully deployed and currently searching for users and clients. Currently, we are trying to expand our user base towards small and medium-sized local businesses in our areas that could really use a booking solution.</p>
        `
      },
      {
        title: 'Ambient Productivity Environment',
        thumbnail: PROJECT_PLACEHOLDER,
        summary: 'A calming background space with movable, customizable productivity widgets.',
        images: [PROJECT_PLACEHOLDER],
        links: [],
        details: `
          <p>Ambient background website in which the use is able to experience a calming, immersive environment. They are able to select which background they want, sort of like a screen saver. After this they have the option to put customizable widgets on the screen. These widgets are fully customizable and can be moved around the screen, resized, and deleted. Widgets include a pomodoro timer, a clock, a sketchpad, a notepad, and more to come. Some additions that I am planning to add is little pets that could run around the screen and be interactive, as well as add more inticing widgets. I would also add music to be more immersive. Overall the purpose is to be a space of productivity and will try to iterate and make it more interactive.</p>
        `
      },
      {
        title: 'Black Hole Physics Simulation',
        thumbnail: PROJECT_PLACEHOLDER,
        summary: 'A Three.js visualization of how a black hole behaves with different parameters.',
        images: [PROJECT_PLACEHOLDER],
        links: [],
        details: `
          <p>Another website that I have developed is a black hole physics simulation, in which I also utilized vite and threejs to create a visualization of how a black hole would operate with different defining parameters. Some additions that I would love to add would be a particle system and more interactive elements. It would be where the user could click and send different objects allowing for the user to observe how a black hole would interact. Another could be its effects on differe celestial bodies. The math involving how blackholes manipulate light and matter would be interesting to try and visualize.</p>
        `
      }
    ]
  },
  "ComputerDisplay2_Raycaster_Hover": {
    title: 'Engineering Projects',
    intro: 'Here is some of the cool physical and engineering projects that I have worked on. Photos and videos are coming soon. Click a project to learn more.',
    projects: [
      {
        title: 'Autonomous Rover',
        thumbnail: PROJECT_PLACEHOLDER,
        summary: 'An emotive, modular rover that navigates terrain using sensors and computer vision.',
        images: [PROJECT_PLACEHOLDER],
        links: [],
        details: `
          <p>I am currently working on an autonomous rover that is able to navigate through different terrains and environments. Inspired by childhood robots and their design, I want to make a rover with emotive expression and personality. I also want it to be responsive and maybe have talkative capabilities. The rover will be equipped with various sensors such as cameras and ultrasonic sensors to help it perceive its surroundings. It uses a combination of computer vision and machine learning algorithms to make decisions and navigate autonomously. The rover is also designed to be modular, allowing for easy upgrades and modifications in the future. My goal is to create a rover that can be used for various applications in a more engaging and emotive way.</p>
        `
      },
      {
        title: 'Adaptable Piano Keyboard',
        thumbnail: PROJECT_PLACEHOLDER,
        summary: 'An accessible keyboard for children with cerebral palsy and other motor disabilities.',
        images: [PROJECT_PLACEHOLDER],
        links: [],
        details: `
          <p>This is a project that I find very endearing. The goal of this project was to create an adaptable piano keyboard for children with cerebral palsy and other motor disabilities. The keyboard is designed to be easy to use and accessible for children with limited mobility. The keyboard features large, colorful keys that are easy to press, as well as a built-in speaker that allows children to hear the notes they are playing. The keyboard also has a variety of different modes and settings that can be adjusted to suit the needs of each individual child. My hope is that this keyboard will help children with disabilities to develop their musical skills and express themselves through music. I have gotten news recognition from my local newspaper.</p>
        `
      },
      {
        title: 'Origami FLOWER Solar Array',
        thumbnail: PROJECT_PLACEHOLDER,
        summary: 'A bi-stable origami module for space that transforms between a solar array and a blast shield.',
        images: [PROJECT_PLACEHOLDER],
        links: [],
        details: `
          <p>I worked on this as an AP research project, something that I would like to present as FLOWER, or the Fault-taulerant Lightweight Origami With Error Recovery. Essentially, I wanted to create an origami module for space systems in which it can be transfigurable between different states, adapting to its environment. For this project I did 2 states, a solar array, and a blast shield, but for future iterations I could make multiple states through the use of origami. I wanted to make it so that the module can be reconfigured in space, and even be able to self-repair if damaged. This would make it very useful for long-term space missions where maintenance is difficult or impossible.</p>
        `
      },
      {
        title: 'Quadruped Linear Actuator Leg',
        thumbnail: PROJECT_PLACEHOLDER,
        summary: 'Custom 3D-printed linear actuators for a dog-like walking robot.',
        images: [PROJECT_PLACEHOLDER],
        links: [],
        details: `
          <p>This is a project that I have been working on for a while now. The goal of this project is to create a quadruped robot that can walk and run like a dog. The robot is designed to be lightweight and agile, with a linear actuator system that allows for smooth and precise movement. since linear actuator cost a lot of money, I took it into my own accords to develop and design my own 3d linear actuator for the legs. For future potential iterations, The robot could be equipped with various sensors such as LIDAR, cameras, and ultrasonic sensors to help it perceive its surroundings. It could use a combination of computer vision and machine learning algorithms to make decisions and navigate autonomously. My hope is that this robot will be able to assist in various applications such as search and rescue, exploration, and environmental monitoring.</p>
        `
      }
    ]
  }
};

function hasModalContent(name) {
  return !!(userContents[name] || projectSections[name]);
}

// which section's grid is showing, and whether a project's detail view is open on top of it
let activeProjectSection = null;
let projectDetailOpen = false;
let projectGridScroll = 0;

function renderProjectGrid(name) {
  const content = document.getElementById('zoom-modal-content');
  const section = projectSections[name];
  if (!content || !section) return;
  activeProjectSection = name;
  projectDetailOpen = false;

  content.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'project-view';
  wrap.innerHTML = `<h1></h1><p class="project-intro"></p><div class="project-grid"></div>`;
  wrap.querySelector('h1').textContent = section.title;
  wrap.querySelector('.project-intro').textContent = section.intro;
  const grid = wrap.querySelector('.project-grid');

  section.projects.forEach((project, i) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'project-card';
    card.setAttribute('aria-label', `Open project ${project.title}`);
    card.innerHTML = `
      <div class="project-card-thumb"><img loading="lazy" decoding="async"></div>
      <div class="project-card-body"><h3></h3><p></p></div>
    `;
    const img = card.querySelector('img');
    img.src = project.thumbnail || PROJECT_PLACEHOLDER;
    img.alt = project.title;
    card.querySelector('h3').textContent = project.title;
    card.querySelector('p').textContent = project.summary;
    card.addEventListener('click', (e) => { e.stopPropagation(); openProjectDetail(name, i, card); });
    grid.appendChild(card);
  });

  content.appendChild(wrap);
  content.scrollTop = projectGridScroll;
}

function openProjectDetail(name, index, card) {
  const content = document.getElementById('zoom-modal-content');
  const project = projectSections[name] && projectSections[name].projects[index];
  if (!content || !project) return;
  projectGridScroll = content.scrollTop;
  projectDetailOpen = true;

  // grow the detail view out of the clicked card's position
  let origin = 'center top';
  if (card) {
    const c = content.getBoundingClientRect();
    const r = card.getBoundingClientRect();
    origin = `${r.left + r.width / 2 - c.left}px ${r.top + r.height / 2 - c.top}px`;
  }

  content.innerHTML = '';
  content.scrollTop = 0;
  const detail = document.createElement('div');
  detail.className = 'project-detail';
  detail.style.transformOrigin = origin;
  detail.innerHTML = `
    <button type="button" class="project-back">&larr; All projects</button>
    <h1></h1>
    <div class="project-detail-images"></div>
    <div class="project-detail-body"></div>
    <div class="project-detail-links"></div>
  `;
  detail.querySelector('h1').textContent = project.title;
  detail.querySelector('.project-back').addEventListener('click', (e) => { e.stopPropagation(); renderProjectGrid(name); });

  const images = detail.querySelector('.project-detail-images');
  (project.images || []).forEach((src) => {
    const img = document.createElement('img');
    img.src = src;
    img.alt = project.title;
    images.appendChild(img);
  });

  detail.querySelector('.project-detail-body').innerHTML = project.details || '';

  const links = detail.querySelector('.project-detail-links');
  if (project.links && project.links.length) {
    links.innerHTML = '<h2>Links</h2><ul></ul>';
    const list = links.querySelector('ul');
    project.links.forEach(({ label, url }) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = label;
      li.appendChild(a);
      list.appendChild(li);
    });
  }

  content.appendChild(detail);
}

// create modal overlay (hidden until used). Prefer static HTML in index.html; otherwise create fallback elements.
function createModal() {
  const existing = document.getElementById('zoom-modal-overlay');
  if (existing) return; // use index.html-provided markup

  const overlay = document.createElement('div');
  overlay.id = 'zoom-modal-overlay';
  overlay.classList.add('zoom-modal-overlay', 'hidden');

  const modal = document.createElement('div');
  modal.id = 'zoom-modal';
  modal.classList.add('zoom-modal');

  const header = document.createElement('div');
  header.classList.add('zoom-modal-header');
  const title = document.createElement('h2');
  title.id = 'zoom-modal-title';
  header.appendChild(title);

  const content = document.createElement('div');
  content.id = 'zoom-modal-content';
  content.classList.add('zoom-modal-content');
  content.contentEditable = 'false';

  modal.appendChild(header);
  modal.appendChild(content);
  overlay.appendChild(modal);
  overlay.addEventListener('click', hideModal);
  document.body.appendChild(overlay);
}
createModal();

function showModalFor(name) {
  const overlay = document.getElementById('zoom-modal-overlay');
  const title = document.getElementById('zoom-modal-title');
  const content = document.getElementById('zoom-modal-content');
  if (!overlay || !title || !content) return;
  // only objects with content (screens, tablet, music book) get a modal; others (e.g. posters) just zoom
  if (!hasModalContent(name)) return;
  // do not show the raw object name as the title; leave header hidden
  title.textContent = '';
  overlay.setAttribute('data-for', name);
  // render HTML content (allows links, images, formatting)
  if (name === 'ArtworkDisplay_Raycaster_Hover') {
    // build gallery inside modal rather than showing the page grid
    // reuse the cached gallery so images aren't re-requested/re-decoded on every open
    content.innerHTML = '';
    content.appendChild(getArtworkGallery());
  } else if (projectSections[name]) {
    projectGridScroll = 0;
    renderProjectGrid(name);
  } else {
    content.innerHTML = userContents[name] || '';
  }
  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');
  // hide header visually by adding a class to the modal element
  const modalEl = document.getElementById('zoom-modal');
  if (modalEl) modalEl.classList.add('no-header');
  isModalOpen = true;
  // pause heavy rendering while user inspects modal/gallery
  try { pauseRendering(); } catch (e) {}
}

function hideModal() {
  const overlay = document.getElementById('zoom-modal-overlay');
  if (!overlay) return;
  closeArtLightbox();
  activeProjectSection = null;
  projectDetailOpen = false;
  overlay.classList.add('hidden');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.removeAttribute('data-for');
  const modalEl = document.getElementById('zoom-modal');
  if (modalEl) modalEl.classList.remove('no-header');
  isModalOpen = false;
  // resume rendering when modal is closed
  try { resumeRendering(); } catch (e) {}
}

// create a simple exit button (hidden until zoomed)
function createExitButton() {
  // intentionally left blank — no standalone exit button is created.
}
createExitButton();

// If index.html provided static elements, ensure they have the right listeners
{
  const overlay = document.getElementById('zoom-modal-overlay');
  if (overlay) {
    overlay.addEventListener('click', hideModal);
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
    const modalEl = document.getElementById('zoom-modal');
    if (modalEl) modalEl.addEventListener('click', (ev) => ev.stopPropagation());
  }

  const exitBtn = document.getElementById('zoom-exit-btn');
  if (exitBtn) {
    exitBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isModalOpen) { hideModal(); return; }
      exitZoom();
    });
    exitBtn.classList.add('hidden');
  }
  const closeBtn = document.getElementById('zoom-modal-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // from a project's detail view, X goes back to the grid; from the grid it closes the modal
      if (projectDetailOpen && activeProjectSection) { renderProjectGrid(activeProjectSection); return; }
      hideModal();
      exitZoom();
    });
  }
}

function zoomToObject(sourceObject) {
  if (!sourceObject || isZoomed) return;
  isZooming = true;
  isZoomed = true;
  currentZoomTarget = sourceObject;
  setTagsVisible(false);

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
      if (btn) btn.classList.remove('hidden');
      isZooming = false;
      // optionally open modal automatically if requested via data attribute
      const overlay = document.getElementById('zoom-modal-overlay');
      const forName = overlay && overlay.getAttribute && overlay.getAttribute('data-pending-open');
      if (forName) {
        overlay.removeAttribute('data-pending-open');
        showModalFor(forName);
      }
    }
  });
}

function zoomToPreset(preset) {
  if (!preset || isZoomed) return;
  isZooming = true;
  isZoomed = true;
  controls.enabled = false;
  setTagsVisible(false);

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
      if (btn) btn.classList.remove('hidden');
      isZooming = false;
      const overlay = document.getElementById('zoom-modal-overlay');
      const forName = overlay && overlay.getAttribute && overlay.getAttribute('data-pending-open');
      if (forName) {
        overlay.removeAttribute('data-pending-open');
        showModalFor(forName);
      }
    }
  });
}


function exitZoom() {
  if (!isZoomed) return;
  // hide modal immediately when exiting
  hideModal();
  const btn = document.getElementById('zoom-exit-btn');
  if (btn) btn.classList.add('hidden');

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
      setTagsVisible(true);
    }
  });
}


// click handler to zoom into the 4 specific named items
window.addEventListener('click', (e) => {
  // the scene is locked while the intro modal is showing
  if (introActive) return;
  // ignore clicks on the UI elements
  if (e.target && (e.target.id === 'zoom-exit-btn' || e.target.closest && e.target.closest('#zoom-modal'))) return;
  // if still zooming, ignore clicks
  if (isZooming) return;
  // if already zoomed, clicking the zoomed object should open its modal (if not open)
  if (isZoomed) {
    // cast and see if we clicked the currently zoomed object
    raycaster.setFromCamera(pointer, camera);
    const hitsWhileZoomed = raycaster.intersectObjects(raycasterObjects);
    let sourceWhile = null;
    if (hitsWhileZoomed && hitsWhileZoomed.length > 0) {
      const pickedWhileZoomed = hitsWhileZoomed[0].object;
      sourceWhile = pickedWhileZoomed.userData && pickedWhileZoomed.userData.sourceObject ? pickedWhileZoomed.userData.sourceObject : pickedWhileZoomed;
      if (sourceWhile && currentZoomTarget && sourceWhile === currentZoomTarget && !isModalOpen) {
        // open modal for this object
        showModalFor(currentZoomTarget.name);
      }
    }
    // objects without a modal (e.g. posters) have no close button, so clicking off them zooms back out
    if (currentZoomTarget && !hasModalContent(currentZoomTarget.name) && sourceWhile !== currentZoomTarget) {
      exitZoom();
    }
    return;
  }

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
    // request modal open after zoom completes by setting a temporary attribute
    const overlay = document.getElementById('zoom-modal-overlay');
    if (overlay) overlay.setAttribute('data-pending-open', source.name);
    zoomToPreset(preset);
    return;
  }
  // fallback: if a non-preset object but still tagged, try auto-zoom
  if (source.userData && source.userData.initialScale) {
    const overlay = document.getElementById('zoom-modal-overlay');
    if (overlay) overlay.setAttribute('data-pending-open', source.name);
    zoomToObject(source);
  }
});

// --------------------- Intro modal ---------------------
// the modal drops off screen while the background unblurs, then the scene is unlocked
function dismissIntro() {
  const overlay = document.getElementById('intro-overlay');
  const modal = document.getElementById('intro-modal');
  const btn = document.getElementById('intro-enter-btn');
  if (!overlay || !modal) { introActive = false; controls.enabled = true; setTagsVisible(true); return; }
  if (btn) btn.disabled = true;
  // stop the CSS entrance animation so it doesn't fight the gsap transform
  modal.style.animation = 'none';
  overlay.classList.add('leaving');

  gsap.timeline({
    onComplete: () => {
      overlay.remove();
      introActive = false;
      controls.enabled = true;
      setTagsVisible(true);
    }
  })
    // small lift before it drops, like it's being let go
    .to(modal, { y: -18, rotation: -1.5, duration: 0.18, ease: 'power1.out' })
    .to(modal, {
      y: window.innerHeight + modal.offsetHeight,
      rotation: 9,
      duration: 0.9,
      ease: 'power2.in'
    });
}

{
  const introBtn = document.getElementById('intro-enter-btn');
  if (introBtn) {
    introBtn.addEventListener('click', dismissIntro);
    introBtn.focus();
  } else {
    introActive = false;
    controls.enabled = true;
    setTagsVisible(true);
  }
}

//pick up video from start of draco
// --------------------- Artwork gallery ---------------------
const artworkImages = [
  'Astonaut.jpg','AWSF.jpg','Banana.jpg','Bird.JPG','Blackhole.jpg','Cabo.jpg','Croc.jpg','Faces.PNG','Flower.JPG','Gohan.JPG','Man.jpg','Name.jpg','Piano.jpg','Pigeon.JPG','Polar.PNG','PW.JPG','Self.png','Spiderman.JPG','Thumbnail.jpg','Waterhand.JPG'
];

function niceTitle(filename) {
  return filename.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
}

// optimized versions are generated by `npm run optimize-art`
function artImagePath(filename, size) {
  return `/images/Artwork/${size}/${filename.replace(/\.[^/.]+$/, '')}.webp`;
}

// full-screen lightbox shown above the gallery modal; clicking anywhere returns to the gallery
function createArtLightbox() {
  const lightbox = document.createElement('div');
  lightbox.id = 'art-lightbox';
  lightbox.className = 'art-lightbox hidden';
  lightbox.setAttribute('aria-hidden', 'true');
  lightbox.innerHTML = `<img class="art-lightbox-img" alt=""><div class="art-lightbox-caption"></div>`;
  lightbox.addEventListener('click', (e) => { e.stopPropagation(); closeArtLightbox(); });
  document.body.appendChild(lightbox);
  return lightbox;
}
const artLightbox = createArtLightbox();

function openArtLightbox(fn, title) {
  const img = artLightbox.querySelector('.art-lightbox-img');
  // show the already-loaded thumbnail immediately, then swap in the large version
  img.src = artImagePath(fn, 'thumbs');
  const large = new Image();
  large.onload = () => { if (img.dataset.fn === fn) img.src = large.src; };
  large.src = artImagePath(fn, 'large');
  img.dataset.fn = fn;
  img.alt = title;
  artLightbox.querySelector('.art-lightbox-caption').textContent = title;
  artLightbox.classList.remove('hidden');
  artLightbox.setAttribute('aria-hidden', 'false');
}

function closeArtLightbox() {
  artLightbox.classList.add('hidden');
  artLightbox.setAttribute('aria-hidden', 'true');
}

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!artLightbox.classList.contains('hidden')) closeArtLightbox();
  else if (isModalOpen && projectDetailOpen && activeProjectSection) renderProjectGrid(activeProjectSection);
  else if (isZoomed && !isModalOpen && !isZooming) exitZoom();
});

let artworkGallery = null;
function getArtworkGallery() {
  if (artworkGallery) return artworkGallery;
  artworkGallery = document.createElement('div');
  artworkGallery.innerHTML = `<h1>Art Pieces</h1>`;
  const grid = document.createElement('div');
  grid.id = 'modal-art-grid';
  grid.className = 'art-grid modal-art-grid';
  artworkGallery.appendChild(grid);
  buildArtworkGallery(grid);
  return artworkGallery;
}

function buildArtworkGallery(container) {
  const grid = container || document.getElementById('art-grid');
  if (!grid) return;
  // clear existing items
  grid.innerHTML = '';
  artworkImages.forEach((fn) => {
    const title = niceTitle(fn);
    const item = document.createElement('div');
    item.className = 'art-item';

    const btn = document.createElement('button');
    btn.className = 'art-thumb';
    btn.setAttribute('aria-label', `Open artwork ${title}`);
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = artImagePath(fn, 'thumbs');
    img.alt = title;
    btn.appendChild(img);
    btn.addEventListener('click', (e) => { e.stopPropagation(); openArtLightbox(fn, title); });

    const cap = document.createElement('div');
    cap.className = 'art-caption';
    cap.textContent = title;

    item.appendChild(btn);
    item.appendChild(cap);
    grid.appendChild(item);
  });
}
