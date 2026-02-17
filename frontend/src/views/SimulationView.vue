<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useProcessStore } from '../stores/process';
import { useThemeStore } from '../stores/theme';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  Color,
  Mesh,
  MeshStandardMaterial,
  MeshPhysicalMaterial,
  PlaneGeometry,
  BoxGeometry,
  CylinderGeometry,
  ConeGeometry,
  TorusGeometry,
  SphereGeometry,
  Group,
  Box3,
  Vector3,
  AmbientLight,
  HemisphereLight,
  DirectionalLight,
  Plane,
  DoubleSide,
  Clock,
  PCFSoftShadowMap,
  CatmullRomCurve3,
  TubeGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  BufferGeometry,
  Line,
} from 'three';

const store = useProcessStore();
const theme = useThemeStore();

const canvasEl = ref(null);
const containerEl = ref(null);
const fileInputEl = ref(null);

const isLoading = ref(false);
const loadError = ref(null);
const isPlaying = ref(true);
const speedMultiplier = ref(1);
const progress = ref(0);
const showFilament = ref(true);

const speedOptions = [0.5, 1, 2, 4];

const UNIT_TO_MM = 10;
const LAYER_HEIGHT_MM = 0.2;
const BASE_SPEED = 0.06;

const canvasColor = computed(() => (theme.isDark ? '#0B0F17' : '#EEF1F5'));
const layerHeightUnits = computed(() => LAYER_HEIGHT_MM / UNIT_TO_MM);

let renderer = null;
let scene = null;
let camera = null;
let controls = null;
let resizeObserver = null;
let animationId = null;
let clock = null;
let resizeHandler = null;

let modelMesh = null;
let nozzleGroup = null;
let bedMesh = null;
let bedGridLines = null;
let clipPlane = null;
let printerGroup = null;
let gantryGroup = null;
let extrusionGroup = null;
let filamentMaterial = null;
let filamentCoolMaterial = null;
let lastExtrudePos = null;
let originalGeometry = null;
let sourceIsZUp = false;
let modelMaterial = null;
let extrusionMesh = null;
let extrusionPoints = [];
let retainedLayers = [];
let spoolGroup = null;
let bowdenTubeMesh = null;
let nozzleGlowMesh = null;

const rotationState = {
  x: 0,
  y: 0,
  z: 0,
};

const printerMetrics = {
  width: 1.4,
  depth: 1.4,
  height: 1.6,
  baseHeight: 0.12,
  frameThickness: 0.06,
  railHeight: 1.1,
  travelMargin: 0.18,
};

const EXTRUSION_RADIUS = 0.012;
const EXTRUSION_POINT_MIN_DISTANCE = 0.025;
const EXTRUSION_MAX_POINTS = 1200;
const RETAINED_LAYER_MAX = 40;

const modelBounds = {
  minY: 0,
  maxY: 1,
  center: new Vector3(),
  size: new Vector3(1, 1, 1),
};

function initScene() {
  scene = new Scene();
  scene.background = new Color(canvasColor.value);

  camera = new PerspectiveCamera(45, 1, 0.01, 1000);
  camera.position.set(3, 2.4, 3);

  renderer = new WebGLRenderer({
    canvas: canvasEl.value,
    antialias: true,
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(canvasColor.value, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.localClippingEnabled = true;

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.6;
  controls.maxDistance = 20;

  clock = new Clock();

  setupLights();
  setupPrinter();
  setupResizeObserver();
}

function setupLights() {
  const ambient = new AmbientLight(0xffffff, 0.55);
  const hemi = new HemisphereLight(0xffffff, 0x444444, 0.6);
  hemi.position.set(0, 10, 0);

  const key = new DirectionalLight(0xffffff, 0.9);
  key.position.set(6, 10, 8);
  key.castShadow = true;
  key.shadow.mapSize.width = 1024;
  key.shadow.mapSize.height = 1024;
  key.shadow.bias = -0.0005;

  const fill = new DirectionalLight(0xffffff, 0.35);
  fill.position.set(-6, 4, -6);

  const rim = new DirectionalLight(0xffffff, 0.25);
  rim.position.set(0, 5, -10);

  scene.add(ambient, hemi, key, fill, rim);
}

function setupBed() {
  const bedW = printerMetrics.width * 0.65;
  const bedD = printerMetrics.depth * 0.65;

  // Textured build plate with grid pattern
  const bedGeometry = new PlaneGeometry(bedW, bedD, 1, 1);
  const bedMaterial = new MeshPhysicalMaterial({
    color: theme.isDark ? '#1a2332' : '#D4D8DE',
    roughness: 0.6,
    metalness: 0.15,
    clearcoat: 0.3,
    clearcoatRoughness: 0.4,
    side: DoubleSide,
  });
  bedMesh = new Mesh(bedGeometry, bedMaterial);
  bedMesh.receiveShadow = true;
  bedMesh.rotation.x = -Math.PI / 2;
  bedMesh.position.y = -0.001;
  scene.add(bedMesh);

  // Grid lines on the bed
  createBedGrid(bedW, bedD);
}

function createBedGrid(bedW, bedD) {
  if (bedGridLines) {
    bedGridLines.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    scene.remove(bedGridLines);
  }

  bedGridLines = new Group();
  bedGridLines.name = 'BedGrid';

  const gridMat = new LineBasicMaterial({
    color: theme.isDark ? '#2a3a4a' : '#B8BCC2',
    transparent: true,
    opacity: 0.5,
  });

  const gridSpacing = 0.05;
  const halfW = bedW * 0.5;
  const halfD = bedD * 0.5;
  const gridY = 0.0005;

  // Lines along X
  for (let z = -halfD; z <= halfD + 0.001; z += gridSpacing) {
    const pts = [new Vector3(-halfW, gridY, z), new Vector3(halfW, gridY, z)];
    const geo = new BufferGeometry().setFromPoints(pts);
    bedGridLines.add(new Line(geo, gridMat));
  }
  // Lines along Z
  for (let x = -halfW; x <= halfW + 0.001; x += gridSpacing) {
    const pts = [new Vector3(x, gridY, -halfD), new Vector3(x, gridY, halfD)];
    const geo = new BufferGeometry().setFromPoints(pts);
    bedGridLines.add(new Line(geo, gridMat));
  }

  scene.add(bedGridLines);
}

function setupPrinter() {
  disposePrinter();

  setupBed();
  setupExtrusion();

  printerGroup = new Group();
  printerGroup.name = 'PrinterMachine';

  const frameMat = new MeshStandardMaterial({
    color: theme.isDark ? '#111827' : '#1F2937',
    roughness: 0.55,
    metalness: 0.4,
  });

  const panelMat = new MeshPhysicalMaterial({
    color: theme.isDark ? '#1F2937' : '#D1D5DB',
    roughness: 0.05,
    metalness: 0.1,
    transparent: true,
    opacity: 0.1,
    transmission: 0.6,
    thickness: 0.02,
    side: DoubleSide,
  });

  const railMat = new MeshStandardMaterial({
    color: '#9CA3AF',
    roughness: 0.2,
    metalness: 0.85,
  });

  const accentMat = new MeshStandardMaterial({
    color: '#374151',
    roughness: 0.4,
    metalness: 0.3,
  });

  const { width, depth, height, baseHeight, frameThickness } = printerMetrics;
  const halfW = width * 0.5;
  const halfD = depth * 0.5;

  // Base with slight bevel look
  const baseGeometry = new BoxGeometry(width * 1.05, baseHeight, depth * 1.05);
  const baseMesh = new Mesh(baseGeometry, accentMat);
  baseMesh.position.y = -baseHeight * 0.5;
  baseMesh.receiveShadow = true;
  printerGroup.add(baseMesh);

  // Rubber feet
  const footMat = new MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.95, metalness: 0.0 });
  const footGeometry = new CylinderGeometry(0.025, 0.028, 0.02, 16);
  const footPositions = [
    [halfW * 0.85, -baseHeight - 0.01, halfD * 0.85],
    [-halfW * 0.85, -baseHeight - 0.01, halfD * 0.85],
    [halfW * 0.85, -baseHeight - 0.01, -halfD * 0.85],
    [-halfW * 0.85, -baseHeight - 0.01, -halfD * 0.85],
  ];
  footPositions.forEach(([x, y, z]) => {
    const foot = new Mesh(footGeometry, footMat);
    foot.position.set(x, y, z);
    printerGroup.add(foot);
  });

  // Corner posts (aluminum extrusion style)
  const postGeometry = new BoxGeometry(frameThickness, height, frameThickness);
  const posts = [
    [halfW, height * 0.5, halfD],
    [-halfW, height * 0.5, halfD],
    [halfW, height * 0.5, -halfD],
    [-halfW, height * 0.5, -halfD],
  ];
  posts.forEach(([x, y, z]) => {
    const post = new Mesh(postGeometry, frameMat);
    post.position.set(x, y, z);
    post.castShadow = true;
    printerGroup.add(post);

    // V-slot groove detail on posts
    const grooveGeometry = new BoxGeometry(frameThickness * 0.3, height * 0.98, 0.005);
    const grooveMat = new MeshStandardMaterial({
      color: theme.isDark ? '#0a0f18' : '#111827',
      roughness: 0.7,
      metalness: 0.3,
    });
    const groove = new Mesh(grooveGeometry, grooveMat);
    groove.position.set(x, y, z + (z > 0 ? 0.031 : -0.031));
    printerGroup.add(groove);
  });

  // Top & bottom beams
  const beamGeometry = new BoxGeometry(width + frameThickness, frameThickness, frameThickness);
  const beamGeometryDepth = new BoxGeometry(frameThickness, frameThickness, depth + frameThickness);
  const topY = height;
  const bottomY = frameThickness;

  const beamPositions = [
    { geo: beamGeometry, pos: [0, topY, halfD] },
    { geo: beamGeometry, pos: [0, topY, -halfD] },
    { geo: beamGeometryDepth, pos: [-halfW, topY, 0] },
    { geo: beamGeometryDepth, pos: [halfW, topY, 0] },
    { geo: beamGeometry, pos: [0, bottomY, halfD] },
    { geo: beamGeometry, pos: [0, bottomY, -halfD] },
    { geo: beamGeometryDepth, pos: [-halfW, bottomY, 0] },
    { geo: beamGeometryDepth, pos: [halfW, bottomY, 0] },
  ];
  beamPositions.forEach(({ geo, pos }) => {
    const beam = new Mesh(geo, frameMat);
    beam.position.set(...pos);
    printerGroup.add(beam);
  });

  // Glass-like panels
  const panelThickness = 0.008;
  const sidePanelGeometry = new BoxGeometry(panelThickness, height * 0.88, depth * 0.93);
  const backPanelGeometry = new BoxGeometry(width * 0.93, height * 0.88, panelThickness);

  const leftPanel = new Mesh(sidePanelGeometry, panelMat);
  leftPanel.position.set(-halfW + panelThickness * 0.5, height * 0.5, 0);
  const rightPanel = new Mesh(sidePanelGeometry, panelMat);
  rightPanel.position.set(halfW - panelThickness * 0.5, height * 0.5, 0);
  const backPanel = new Mesh(backPanelGeometry, panelMat);
  backPanel.position.set(0, height * 0.5, -halfD + panelThickness * 0.5);
  const topPanel = new Mesh(new BoxGeometry(width * 0.93, panelThickness, depth * 0.93), panelMat);
  topPanel.position.set(0, height + panelThickness * 0.5, 0);

  printerGroup.add(leftPanel, rightPanel, backPanel, topPanel);

  // Stepper motors (NEMA17 style) at base corners
  setupStepperMotors(printerGroup, frameMat, halfW, halfD, baseHeight);

  // LCD control panel on front
  setupLcdPanel(printerGroup, halfD, baseHeight);

  // Gantry system
  gantryGroup = new Group();
  gantryGroup.name = 'Gantry';
  gantryGroup.position.y = printerMetrics.railHeight;

  // Dual linear rails
  const railGeometry = new CylinderGeometry(0.012, 0.012, width * 0.88, 12);
  railGeometry.rotateZ(Math.PI / 2);
  const rail1 = new Mesh(railGeometry, railMat);
  rail1.position.set(0, 0.01, 0.025);
  const rail2 = new Mesh(railGeometry, railMat);
  rail2.position.set(0, 0.01, -0.025);
  gantryGroup.add(rail1, rail2);

  // Timing belt along X axis
  const beltMat = new MeshStandardMaterial({
    color: '#1a1a1a',
    roughness: 0.8,
    metalness: 0.05,
  });
  const beltGeometry = new BoxGeometry(width * 0.85, 0.006, 0.008);
  const belt = new Mesh(beltGeometry, beltMat);
  belt.position.set(0, -0.015, 0);
  gantryGroup.add(belt);

  // Carriage block
  const carriageGeometry = new BoxGeometry(frameThickness * 2.0, frameThickness * 1.0, frameThickness * 1.8);
  const carriage = new Mesh(carriageGeometry, accentMat);
  carriage.position.set(0, -frameThickness * 0.15, 0);
  carriage.castShadow = true;
  gantryGroup.add(carriage);

  // Heatsink fins on carriage
  const finMat = new MeshStandardMaterial({ color: '#A0A5AB', roughness: 0.3, metalness: 0.7 });
  for (let i = 0; i < 5; i++) {
    const fin = new Mesh(
      new BoxGeometry(frameThickness * 1.8, 0.004, frameThickness * 1.6),
      finMat
    );
    fin.position.set(0, -frameThickness * 0.55 - i * 0.008, 0);
    gantryGroup.add(fin);
  }

  // Fan shroud
  const fanShroudMat = new MeshStandardMaterial({
    color: '#2563EB',
    roughness: 0.5,
    metalness: 0.2,
  });
  const fanShroud = new Mesh(
    new BoxGeometry(0.05, 0.04, 0.06),
    fanShroudMat
  );
  fanShroud.position.set(0.055, -frameThickness * 0.7, 0);
  gantryGroup.add(fanShroud);

  // Part cooling fan (small cylinder)
  const fanMat = new MeshStandardMaterial({ color: '#1E40AF', roughness: 0.4, metalness: 0.3 });
  const fanCylinder = new Mesh(new CylinderGeometry(0.02, 0.02, 0.015, 16), fanMat);
  fanCylinder.rotation.z = Math.PI / 2;
  fanCylinder.position.set(0.055, -frameThickness * 0.7, 0.035);
  gantryGroup.add(fanCylinder);

  nozzleGroup = createNozzle();
  nozzleGroup.position.set(0, -frameThickness * 0.9, 0);
  gantryGroup.add(nozzleGroup);

  printerGroup.add(gantryGroup);

  // Filament spool holder + spool
  setupSpoolHolder(printerGroup, height, halfD);

  scene.add(printerGroup);

  // Bowden tube from spool area to gantry
  updateBowdenTube();
}

function setupStepperMotors(parent, frameMat, halfW, halfD, baseHeight) {
  const motorMat = new MeshStandardMaterial({
    color: '#1a1a1a',
    roughness: 0.7,
    metalness: 0.3,
  });
  const shaftMat = new MeshStandardMaterial({
    color: '#C0C0C0',
    roughness: 0.2,
    metalness: 0.9,
  });

  const motorPositions = [
    [halfW - 0.05, baseHeight * 0.5 + 0.025, halfD - 0.05],
    [-halfW + 0.05, baseHeight * 0.5 + 0.025, -halfD + 0.05],
  ];

  motorPositions.forEach(([x, y, z]) => {
    const motorBody = new Mesh(new BoxGeometry(0.042, 0.042, 0.042), motorMat);
    motorBody.position.set(x, y, z);
    motorBody.castShadow = true;
    parent.add(motorBody);

    // Motor shaft
    const shaft = new Mesh(new CylinderGeometry(0.005, 0.005, 0.025, 12), shaftMat);
    shaft.position.set(x, y + 0.033, z);
    parent.add(shaft);

    // Pulley on shaft
    const pulley = new Mesh(new CylinderGeometry(0.01, 0.01, 0.012, 16), shaftMat);
    pulley.position.set(x, y + 0.035, z);
    parent.add(pulley);
  });

  // Z-axis motor (back center)
  const zMotor = new Mesh(new BoxGeometry(0.042, 0.042, 0.042), motorMat);
  zMotor.position.set(0, baseHeight * 0.5 + 0.025, -halfD + 0.05);
  zMotor.castShadow = true;
  parent.add(zMotor);

  const zShaft = new Mesh(new CylinderGeometry(0.004, 0.004, 0.06, 12), shaftMat);
  zShaft.position.set(0, baseHeight * 0.5 + 0.072, -halfD + 0.05);
  parent.add(zShaft);

  // Lead screw (long threaded rod)
  const leadScrewMat = new MeshStandardMaterial({ color: '#B0B0B0', roughness: 0.35, metalness: 0.8 });
  const leadScrew = new Mesh(
    new CylinderGeometry(0.006, 0.006, printerMetrics.height * 0.85, 12),
    leadScrewMat
  );
  leadScrew.position.set(0, printerMetrics.height * 0.45, -halfD + 0.05);
  parent.add(leadScrew);
}

function setupLcdPanel(parent, halfD, baseHeight) {
  // LCD screen housing
  const lcdHousingMat = new MeshStandardMaterial({
    color: '#1F2937',
    roughness: 0.5,
    metalness: 0.2,
  });
  const lcdHousing = new Mesh(
    new BoxGeometry(0.14, 0.08, 0.02),
    lcdHousingMat
  );
  lcdHousing.position.set(0.22, baseHeight * 0.5 + 0.05, halfD + 0.01);
  parent.add(lcdHousing);

  // LCD screen (emissive)
  const lcdScreenMat = new MeshStandardMaterial({
    color: '#0f172a',
    emissive: '#1d4ed8',
    emissiveIntensity: 0.4,
    roughness: 0.1,
    metalness: 0.0,
  });
  const lcdScreen = new Mesh(
    new BoxGeometry(0.12, 0.06, 0.005),
    lcdScreenMat
  );
  lcdScreen.position.set(0.22, baseHeight * 0.5 + 0.05, halfD + 0.021);
  parent.add(lcdScreen);

  // Rotary encoder knob
  const knobMat = new MeshStandardMaterial({ color: '#4B5563', roughness: 0.4, metalness: 0.5 });
  const knob = new Mesh(new CylinderGeometry(0.012, 0.012, 0.015, 16), knobMat);
  knob.rotation.x = Math.PI / 2;
  knob.position.set(0.36, baseHeight * 0.5 + 0.05, halfD + 0.015);
  parent.add(knob);
}

function setupSpoolHolder(parent, height, halfD) {
  if (spoolGroup) {
    spoolGroup.traverse((child) => {
      if (child.isMesh) disposeMesh(child);
    });
    spoolGroup = null;
  }

  spoolGroup = new Group();
  spoolGroup.name = 'SpoolHolder';

  const holderMat = new MeshStandardMaterial({
    color: '#374151',
    roughness: 0.4,
    metalness: 0.5,
  });

  // Horizontal rod holder
  const holderRod = new Mesh(
    new CylinderGeometry(0.008, 0.008, 0.18, 12),
    holderMat
  );
  holderRod.rotation.x = Math.PI / 2;
  holderRod.position.set(0, height + 0.08, -halfD + 0.08);
  spoolGroup.add(holderRod);

  // Bracket
  const bracket = new Mesh(new BoxGeometry(0.03, 0.06, 0.02), holderMat);
  bracket.position.set(0, height + 0.05, -halfD + 0.01);
  spoolGroup.add(bracket);

  // Filament spool (torus)
  const spoolMat = new MeshStandardMaterial({
    color: '#E5E7EB',
    roughness: 0.5,
    metalness: 0.05,
  });
  const spool = new Mesh(
    new TorusGeometry(0.06, 0.025, 16, 32),
    spoolMat
  );
  spool.position.set(0, height + 0.08, -halfD + 0.08);
  spool.rotation.y = Math.PI / 2;
  spoolGroup.add(spool);

  // Spool hub (inner disc)
  const hubMat = new MeshStandardMaterial({
    color: '#9CA3AF',
    roughness: 0.4,
    metalness: 0.3,
  });
  const hub1 = new Mesh(new CylinderGeometry(0.035, 0.035, 0.005, 24), hubMat);
  hub1.rotation.x = Math.PI / 2;
  hub1.position.set(0, height + 0.08, -halfD + 0.055);
  spoolGroup.add(hub1);
  const hub2 = new Mesh(new CylinderGeometry(0.035, 0.035, 0.005, 24), hubMat);
  hub2.rotation.x = Math.PI / 2;
  hub2.position.set(0, height + 0.08, -halfD + 0.105);
  spoolGroup.add(hub2);

  // Filament wrapped on spool
  const filamentWrapMat = new MeshStandardMaterial({
    color: '#D1D5DB',
    roughness: 0.35,
    metalness: 0.05,
    emissive: '#F3D0A6',
    emissiveIntensity: 0.02,
  });
  const filamentWrap = new Mesh(
    new TorusGeometry(0.055, 0.018, 12, 32),
    filamentWrapMat
  );
  filamentWrap.position.set(0, height + 0.08, -halfD + 0.08);
  filamentWrap.rotation.y = Math.PI / 2;
  spoolGroup.add(filamentWrap);

  parent.add(spoolGroup);
}

function updateBowdenTube() {
  if (bowdenTubeMesh) {
    bowdenTubeMesh.geometry.dispose();
    bowdenTubeMesh.material.dispose();
    scene.remove(bowdenTubeMesh);
    bowdenTubeMesh = null;
  }

  if (!gantryGroup || !printerGroup) return;

  const { height, depth } = printerMetrics;
  const halfD = depth * 0.5;

  // From spool area down to gantry carriage
  const spoolPos = new Vector3(0, height + 0.06, -halfD + 0.08);
  const midPoint = new Vector3(0.05, height * 0.85, -halfD * 0.3);
  const gantryPos = new Vector3(
    gantryGroup.position.x || 0,
    gantryGroup.position.y + 0.04,
    (gantryGroup.position.z || 0)
  );

  const bowdenCurve = new CatmullRomCurve3([spoolPos, midPoint, gantryPos], false, 'catmullrom');
  const bowdenGeo = new TubeGeometry(bowdenCurve, 24, 0.006, 8, false);
  const bowdenMat = new MeshStandardMaterial({
    color: '#E8E8E8',
    roughness: 0.3,
    metalness: 0.05,
    transparent: true,
    opacity: 0.7,
  });
  bowdenTubeMesh = new Mesh(bowdenGeo, bowdenMat);
  scene.add(bowdenTubeMesh);
}

function setupExtrusion() {
  if (extrusionGroup) {
    clearExtrusion();
    scene.remove(extrusionGroup);
  }

  // Hot filament material (warm color near nozzle)
  filamentMaterial = new MeshStandardMaterial({
    color: '#E8DDD0',
    roughness: 0.3,
    metalness: 0.04,
    emissive: '#F5A623',
    emissiveIntensity: 0.15,
    transparent: true,
    opacity: 0.88,
    clippingPlanes: clipPlane ? [clipPlane] : null,
    clipShadows: true,
  });

  // Cooled filament material (for retained layers)
  filamentCoolMaterial = new MeshStandardMaterial({
    color: '#D1D5DB',
    roughness: 0.38,
    metalness: 0.05,
    emissive: '#F3D0A6',
    emissiveIntensity: 0.02,
    clippingPlanes: clipPlane ? [clipPlane] : null,
    clipShadows: true,
  });

  extrusionGroup = new Group();
  extrusionGroup.name = 'Extrusion';
  scene.add(extrusionGroup);
  lastExtrudePos = null;
  extrusionPoints = [];
  extrusionMesh = null;
  retainedLayers = [];
}

function createNozzle() {
  const group = new Group();

  // Heat block
  const heatBlockMat = new MeshStandardMaterial({
    color: '#B0B0B0',
    roughness: 0.35,
    metalness: 0.6,
  });
  const heatBlock = new Mesh(new BoxGeometry(0.035, 0.02, 0.025), heatBlockMat);
  heatBlock.position.y = -0.06;
  heatBlock.castShadow = true;
  group.add(heatBlock);

  // Nozzle body (heat break)
  const nozzleBody = new CylinderGeometry(0.015, 0.015, 0.12, 24);
  const bodyMaterial = new MeshStandardMaterial({
    color: '#C7C9CC',
    roughness: 0.25,
    metalness: 0.75,
  });
  const bodyMesh = new Mesh(nozzleBody, bodyMaterial);
  bodyMesh.castShadow = true;
  group.add(bodyMesh);

  // Nozzle tip (brass)
  const nozzleTip = new ConeGeometry(0.02, 0.04, 24);
  const tipMaterial = new MeshStandardMaterial({
    color: '#B87333',
    roughness: 0.2,
    metalness: 0.7,
    emissive: '#8B4513',
    emissiveIntensity: 0.15,
  });
  const tipMesh = new Mesh(nozzleTip, tipMaterial);
  tipMesh.position.y = -0.09;
  tipMesh.castShadow = true;
  group.add(tipMesh);

  // Nozzle glow (hot tip indicator)
  const glowMat = new MeshStandardMaterial({
    color: '#FF6B35',
    emissive: '#FF4500',
    emissiveIntensity: 0.6,
    transparent: true,
    opacity: 0.35,
  });
  nozzleGlowMesh = new Mesh(new SphereGeometry(0.018, 16, 16), glowMat);
  nozzleGlowMesh.position.y = -0.11;
  group.add(nozzleGlowMesh);

  // Thermistor wire (tiny detail)
  const wireMat = new MeshStandardMaterial({ color: '#DC2626', roughness: 0.6, metalness: 0.1 });
  const wire = new Mesh(new CylinderGeometry(0.002, 0.002, 0.04, 6), wireMat);
  wire.rotation.z = Math.PI / 4;
  wire.position.set(0.02, -0.05, 0);
  group.add(wire);

  return group;
}

function setupResizeObserver() {
  if (!containerEl.value) return;

  const handleResize = () => {
    const width = containerEl.value.clientWidth;
    const height = containerEl.value.clientHeight;
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };

  handleResize();

  resizeObserver = new ResizeObserver(handleResize);
  resizeObserver.observe(containerEl.value);
  resizeHandler = handleResize;
  window.addEventListener('resize', resizeHandler);
}

function teardownScene() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }

  if (resizeObserver && containerEl.value) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }

  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler);
    resizeHandler = null;
  }

  if (controls) {
    controls.dispose();
    controls = null;
  }

  if (modelMesh) {
    disposeMesh(modelMesh);
    modelMesh = null;
  }

  disposePrinter();

  if (renderer) {
    renderer.dispose();
    renderer = null;
  }

  scene = null;
  camera = null;
}

function disposePrinter() {
  if (!scene) return;

  if (bedMesh) {
    disposeMesh(bedMesh);
    scene.remove(bedMesh);
    bedMesh = null;
  }

  if (bedGridLines) {
    bedGridLines.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    scene.remove(bedGridLines);
    bedGridLines = null;
  }

  if (extrusionGroup) {
    clearExtrusion();
    scene.remove(extrusionGroup);
    extrusionGroup = null;
  }

  filamentMaterial = null;
  filamentCoolMaterial = null;
  lastExtrudePos = null;
  extrusionPoints = [];
  extrusionMesh = null;
  retainedLayers = [];

  if (bowdenTubeMesh) {
    bowdenTubeMesh.geometry.dispose();
    bowdenTubeMesh.material.dispose();
    scene.remove(bowdenTubeMesh);
    bowdenTubeMesh = null;
  }

  if (printerGroup) {
    printerGroup.traverse((child) => {
      if (child.isMesh) {
        disposeMesh(child);
      }
    });
    scene.remove(printerGroup);
    printerGroup = null;
  }

  nozzleGroup = null;
  nozzleGlowMesh = null;
  gantryGroup = null;
  spoolGroup = null;
}

function disposeMesh(mesh) {
  if (!mesh) return;
  if (mesh.geometry) mesh.geometry.dispose();
  if (mesh.material) {
    if (Array.isArray(mesh.material)) {
      mesh.material.forEach((mat) => mat.dispose());
    } else {
      mesh.material.dispose();
    }
  }
}

function applyLayerLines(material, layerHeight) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.layerFreq = { value: (Math.PI * 2) / layerHeight };
    shader.uniforms.layerStrength = { value: 0.08 };
    shader.vertexShader = shader.vertexShader
      .replace('varying vec3 vViewPosition;', 'varying vec3 vViewPosition;\nvarying float vWorldY;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvWorldY = worldPosition.y;'
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        'uniform float layerFreq;\nuniform float layerStrength;\nvoid main() {'
      )
      .replace('varying vec3 vViewPosition;', 'varying vec3 vViewPosition;\nvarying float vWorldY;')
      .replace(
        '#include <dithering_fragment>',
        'float layerLine = abs(sin(vWorldY * layerFreq));\nlayerLine = smoothstep(0.2, 0.95, layerLine);\nvec3 layerTint = mix(vec3(1.0), vec3(0.85), layerLine * layerStrength);\noutgoingLight *= layerTint;\n#include <dithering_fragment>'
      );

    material.userData.shader = shader;
  };
  material.needsUpdate = true;
}

function computeAutoScale(size) {
  const buildVolume = {
    x: printerMetrics.width * 0.62,
    y: printerMetrics.height * 0.55,
    z: printerMetrics.depth * 0.62,
  };

  const scaleX = size.x > 0 ? buildVolume.x / size.x : 1;
  const scaleY = size.y > 0 ? buildVolume.y / size.y : 1;
  const scaleZ = size.z > 0 ? buildVolume.z / size.z : 1;

  const scale = Math.min(scaleX, scaleY, scaleZ);
  if (!Number.isFinite(scale)) return 1;

  const maxScale = 3.0;
  return Math.min(maxScale, scale);
}

async function loadStlFromFile(file) {
  if (!file) return;
  isLoading.value = true;
  loadError.value = null;

  try {
    const arrayBuffer = await file.arrayBuffer();
    const loader = new STLLoader();
    const geometry = loader.parse(arrayBuffer);

    geometry.computeVertexNormals();

    let box = new Box3().setFromBufferAttribute(geometry.attributes.position);
    const size = new Vector3();
    box.getSize(size);

    sourceIsZUp = size.z > size.y * 1.2;
    originalGeometry = geometry;

    rebuildModelFromSource();
  } catch (error) {
    console.error('Failed to load STL:', error);
    loadError.value = 'Failed to load STL file. Please try another file.';
  } finally {
    isLoading.value = false;
  }
}

function rebuildModelFromSource() {
  if (!originalGeometry) return;

  const geometry = originalGeometry.clone();
  geometry.computeVertexNormals();

  if (sourceIsZUp) {
    geometry.rotateX(-Math.PI / 2);
  }

  geometry.rotateX(rotationState.x);
  geometry.rotateY(rotationState.y);
  geometry.rotateZ(rotationState.z);

  let box = new Box3().setFromBufferAttribute(geometry.attributes.position);
  const size = new Vector3();
  box.getSize(size);

  const scaleFactor = computeAutoScale(size);
  geometry.scale(scaleFactor, scaleFactor, scaleFactor);

  box = new Box3().setFromBufferAttribute(geometry.attributes.position);
  const center = new Vector3();
  box.getCenter(center);
  geometry.translate(-center.x, -box.min.y, -center.z);

  box = new Box3().setFromBufferAttribute(geometry.attributes.position);
  const finalSize = new Vector3();
  box.getSize(finalSize);

  modelBounds.minY = box.min.y;
  modelBounds.maxY = box.max.y;
  modelBounds.center.set(0, finalSize.y * 0.5, 0);
  modelBounds.size.copy(finalSize);

  clipPlane = new Plane(new Vector3(0, -1, 0), modelBounds.minY);

  setupPrinter();
  if (filamentMaterial) {
    filamentMaterial.clippingPlanes = [clipPlane];
  }
  if (filamentCoolMaterial) {
    filamentCoolMaterial.clippingPlanes = [clipPlane];
  }

  if (modelMesh) {
    scene.remove(modelMesh);
    disposeMesh(modelMesh);
    modelMesh = null;
  }

  if (modelMaterial) {
    modelMaterial.dispose();
  }

  modelMaterial = new MeshStandardMaterial({
    color: theme.isDark ? '#D1D5DB' : '#6B7280',
    roughness: 0.45,
    metalness: 0.12,
    clippingPlanes: [clipPlane],
    clipShadows: true,
    side: DoubleSide,
  });

  applyLayerLines(modelMaterial, layerHeightUnits.value);

  modelMesh = new Mesh(geometry, modelMaterial);
  modelMesh.castShadow = true;
  modelMesh.receiveShadow = false;
  scene.add(modelMesh);

  updateBedScale();
  frameCamera();
  restartSimulation();
}

function updateBedScale() {
  // Bed is already sized in setupBed, no dynamic scaling needed
}

function frameCamera() {
  const maxDim = Math.max(printerMetrics.width, printerMetrics.height, printerMetrics.depth);
  const distance = Math.max(1.8, maxDim * 1.6);
  camera.position.set(distance, distance * 0.8, distance * 1.05);
  controls.target.set(0, printerMetrics.height * 0.35, 0);
  controls.update();
}

let lastRetainedLayer = -1;

function updateSimulation(delta) {
  if (!modelMesh || !clipPlane) return;

  if (isPlaying.value) {
    progress.value = Math.min(1, progress.value + delta * BASE_SPEED * speedMultiplier.value);
    if (progress.value >= 1) {
      progress.value = 1;
      isPlaying.value = false;
    }
  }

  const currentHeight = modelBounds.minY + progress.value * (modelBounds.maxY - modelBounds.minY);
  clipPlane.constant = currentHeight;

  const motion = computeNozzleMotion(currentHeight);
  updateNozzlePosition(currentHeight, motion);
  updateExtrusion(currentHeight, motion);
  updateNozzleGlow();
  updateBowdenTube();
}

function computeNozzleMotion(currentHeight) {
  const layerHeight = layerHeightUnits.value;
  const safeLayerHeight = layerHeight > 0 ? layerHeight : 0.01;
  const layerIndex = Math.max(0, Math.floor((currentHeight - modelBounds.minY) / safeLayerHeight));
  const layerProgress = (currentHeight - modelBounds.minY) / safeLayerHeight - layerIndex;

  const travelX = Math.max(0.12, printerMetrics.width * 0.35 - printerMetrics.travelMargin);
  const travelZ = Math.max(0.12, printerMetrics.depth * 0.35 - printerMetrics.travelMargin);
  const radiusX = Math.min(Math.max(0.08, modelBounds.size.x * 0.55), travelX);
  const radiusZ = Math.min(Math.max(0.08, modelBounds.size.z * 0.55), travelZ);
  const theta = layerIndex * 0.35 + layerProgress * Math.PI * 2;

  const x = Math.cos(theta) * radiusX;
  const z = Math.sin(theta) * radiusZ;

  return {
    x,
    z,
    theta,
    layerIndex,
    layerProgress,
  };
}

function updateNozzlePosition(currentHeight, motion) {
  if (!nozzleGroup) return;

  if (gantryGroup) {
    const gantryY = Math.min(printerMetrics.railHeight, Math.max(0.12, currentHeight + 0.18));
    gantryGroup.position.y = gantryY;
  }

  nozzleGroup.position.set(motion.x, 0.08, motion.z);
  nozzleGroup.rotation.y = motion.theta + Math.PI / 2;
}

function updateNozzleGlow() {
  if (!nozzleGlowMesh) return;
  // Pulsing glow effect
  const t = clock.elapsedTime;
  const pulse = 0.25 + Math.sin(t * 3) * 0.1;
  nozzleGlowMesh.material.opacity = pulse;
  nozzleGlowMesh.material.emissiveIntensity = 0.4 + Math.sin(t * 4) * 0.2;
}

function updateExtrusion(currentHeight, motion) {
  if (!extrusionGroup || !filamentMaterial || !isPlaying.value || !showFilament.value) {
    lastExtrudePos = null;
    return;
  }

  const shouldExtrude = motion.layerProgress > 0.08 && motion.layerProgress < 0.95;

  // Retain current layer's extrusion when transitioning to a new layer
  if (motion.layerIndex !== lastRetainedLayer && extrusionPoints.length >= 2) {
    retainCurrentLayerExtrusion();
    lastRetainedLayer = motion.layerIndex;
  }

  if (!shouldExtrude) {
    lastExtrudePos = null;
    return;
  }

  const target = new Vector3(motion.x, currentHeight + 0.001, motion.z);
  if (!lastExtrudePos) {
    lastExtrudePos = target.clone();
    return;
  }

  const distance = lastExtrudePos.distanceTo(target);
  if (distance < EXTRUSION_POINT_MIN_DISTANCE) return;

  extrusionPoints.push(target.clone());
  if (extrusionPoints.length === 1) {
    extrusionPoints.unshift(lastExtrudePos.clone());
  }
  if (extrusionPoints.length > EXTRUSION_MAX_POINTS) {
    extrusionPoints.splice(0, extrusionPoints.length - EXTRUSION_MAX_POINTS);
  }

  lastExtrudePos.copy(target);
  rebuildExtrusionTube();
}

function retainCurrentLayerExtrusion() {
  if (!extrusionGroup || !filamentCoolMaterial || extrusionPoints.length < 2) return;

  // Build a cooled version of the current extrusion as a retained layer
  const curve = new CatmullRomCurve3([...extrusionPoints], false, 'centripetal');
  const tubularSegments = Math.min(200, Math.max(20, extrusionPoints.length * 2));
  const geometry = new TubeGeometry(curve, tubularSegments, EXTRUSION_RADIUS * 0.95, 8, false);

  const layerMesh = new Mesh(geometry, filamentCoolMaterial);
  layerMesh.castShadow = false;
  layerMesh.receiveShadow = true;
  extrusionGroup.add(layerMesh);
  retainedLayers.push(layerMesh);

  // Limit retained layers to prevent memory issues
  if (retainedLayers.length > RETAINED_LAYER_MAX) {
    const old = retainedLayers.shift();
    if (old) {
      old.geometry.dispose();
      extrusionGroup.remove(old);
    }
  }

  // Clear current extrusion points for the new layer
  extrusionPoints = [];
  if (extrusionMesh) {
    extrusionMesh.geometry.dispose();
    extrusionGroup.remove(extrusionMesh);
    extrusionMesh = null;
  }
}

function rebuildExtrusionTube() {
  if (!extrusionGroup || !filamentMaterial || extrusionPoints.length < 2) return;

  const curve = new CatmullRomCurve3(extrusionPoints, false, 'centripetal');
  const tubularSegments = Math.min(240, Math.max(32, extrusionPoints.length * 3));
  const geometry = new TubeGeometry(curve, tubularSegments, EXTRUSION_RADIUS, 10, false);

  // Apply cooling color gradient via vertex colors
  applyExtrusionVertexColors(geometry, extrusionPoints.length);

  if (!extrusionMesh) {
    // Use a material that supports vertex colors for the active extrusion
    const activeMat = filamentMaterial.clone();
    activeMat.vertexColors = true;
    extrusionMesh = new Mesh(geometry, activeMat);
    extrusionMesh.castShadow = false;
    extrusionMesh.receiveShadow = true;
    extrusionGroup.add(extrusionMesh);
  } else {
    extrusionMesh.geometry.dispose();
    extrusionMesh.geometry = geometry;
  }
}

function applyExtrusionVertexColors(geometry, pointCount) {
  const posAttr = geometry.attributes.position;
  const count = posAttr.count;
  const colors = new Float32Array(count * 3);

  // Warm color (freshly extruded) to cool color (solidified)
  const warmR = 0.96, warmG = 0.65, warmB = 0.35; // orange-ish warm
  const coolR = 0.82, coolG = 0.84, coolB = 0.86; // light gray cool

  // TubeGeometry has (tubularSegments+1) * (radialSegments+1) vertices
  // The tubular direction maps to the path progress
  const radialSegments = 10;
  const radialCount = radialSegments + 1;

  for (let i = 0; i < count; i++) {
    const tubularIndex = Math.floor(i / radialCount);
    const totalTubular = Math.ceil(count / radialCount);
    const t = totalTubular > 1 ? tubularIndex / (totalTubular - 1) : 1;

    // t=0 is start (cool), t=1 is end/tip (warm)
    const warmFactor = Math.pow(t, 2.5); // more warm concentrated at the tip
    colors[i * 3] = coolR + (warmR - coolR) * warmFactor;
    colors[i * 3 + 1] = coolG + (warmG - coolG) * warmFactor;
    colors[i * 3 + 2] = coolB + (warmB - coolB) * warmFactor;
  }

  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
}

function clearExtrusion() {
  if (!extrusionGroup) return;
  extrusionGroup.traverse((child) => {
    if (child.isMesh) {
      if (child.geometry) child.geometry.dispose();
      // Don't dispose shared materials (filamentCoolMaterial)
      if (child.material && child.material !== filamentCoolMaterial && child.material !== filamentMaterial) {
        child.material.dispose();
      }
    }
  });
  extrusionGroup.clear();
  lastExtrudePos = null;
  extrusionPoints = [];
  extrusionMesh = null;
  retainedLayers = [];
  lastRetainedLayer = -1;
}

function animate() {
  animationId = requestAnimationFrame(animate);
  const delta = clock.getDelta();
  updateSimulation(delta);
  controls.update();
  renderer.render(scene, camera);
}

function restartSimulation() {
  progress.value = 0;
  isPlaying.value = true;
  lastRetainedLayer = -1;
  clearExtrusion();
}

function handleFileChange(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = '';

  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.stl')) {
    loadError.value = 'Please select a .stl file.';
    return;
  }

  store.setSimulationStlFile(file);
}

function triggerFilePick() {
  if (fileInputEl.value) {
    fileInputEl.value.click();
  }
}

function goToUpload() {
  store.closeSimulation();
  // If background operation exists, just navigate (don't reset)
  if (store.backgroundOperation.type !== null || store.isProcessing || store.isRetexturing) {
    store.currentStepIndex = 0;
  } else {
    store.currentStepIndex = 0;
  }
}

function rotateModel(axis, direction) {
  const delta = (Math.PI / 2) * direction;
  if (axis === 'x') rotationState.x = (rotationState.x + delta) % (Math.PI * 2);
  if (axis === 'y') rotationState.y = (rotationState.y + delta) % (Math.PI * 2);
  if (axis === 'z') rotationState.z = (rotationState.z + delta) % (Math.PI * 2);
  rebuildModelFromSource();
}

function resetRotation() {
  rotationState.x = 0;
  rotationState.y = 0;
  rotationState.z = 0;
  rebuildModelFromSource();
}

function toggleFilament() {
  showFilament.value = !showFilament.value;
  if (!showFilament.value) {
    clearExtrusion();
  }
}

function togglePlay() {
  if (progress.value >= 1) {
    restartSimulation();
    return;
  }
  isPlaying.value = !isPlaying.value;
}

watch(
  () => store.simulationStlFile,
  (file) => {
    if (file) loadStlFromFile(file);
  },
  { immediate: true }
);

watch(
  () => theme.isDark,
  () => {
    if (renderer) {
      renderer.setClearColor(canvasColor.value, 1);
    }
    if (scene) {
      scene.background = new Color(canvasColor.value);
    }
    if (bedMesh && bedMesh.material) {
      bedMesh.material.color = new Color(theme.isDark ? '#1a2332' : '#D4D8DE');
    }
    if (modelMaterial) {
      modelMaterial.color = new Color(theme.isDark ? '#D1D5DB' : '#6B7280');
    }
  }
);

onMounted(() => {
  initScene();
  animate();
});

onBeforeUnmount(() => {
  teardownScene();
});
</script>

<template>
  <div ref="containerEl" class="relative h-[calc(100vh-160px)] w-full overflow-hidden rounded-2xl border border-white/20 dark:border-gray-800">
    <canvas ref="canvasEl" class="absolute inset-0 h-full w-full"></canvas>
    <input ref="fileInputEl" type="file" accept=".stl" class="hidden" @change="handleFileChange" />

    <div class="absolute inset-0 pointer-events-none p-4 flex flex-col justify-between">
      <div class="pointer-events-auto flex items-start justify-between gap-4">
        <div class="bg-white/85 dark:bg-gray-900/80 backdrop-blur border border-gray-200/80 dark:border-gray-700/80 rounded-xl px-4 py-3 shadow-lg max-w-md">
          <p class="text-[10px] uppercase tracking-widest text-gray-400">3D Print Simulation</p>
          <h2 class="text-lg font-bold text-brand-dark dark:text-white">FDM Layer-by-Layer</h2>
          <p class="text-xs text-gray-500 dark:text-gray-400">Realistic extrusion reveal synced to model geometry.</p>
          <div v-if="store.simulationStlFile" class="mt-3 space-y-2 text-[11px] text-gray-500 dark:text-gray-400">
            <div class="flex flex-wrap items-center gap-2">
              <span class="uppercase tracking-wider text-[10px] text-gray-400">Rotate</span>
              <button
                @click="rotateModel('x', -1)"
                class="px-2.5 py-1 rounded-full border border-gray-200 dark:border-gray-700 hover:border-brand-dark dark:hover:border-brand-teal transition-colors"
              >
                X-
              </button>
              <button
                @click="rotateModel('x', 1)"
                class="px-2.5 py-1 rounded-full border border-gray-200 dark:border-gray-700 hover:border-brand-dark dark:hover:border-brand-teal transition-colors"
              >
                X+
              </button>
              <button
                @click="rotateModel('y', -1)"
                class="px-2.5 py-1 rounded-full border border-gray-200 dark:border-gray-700 hover:border-brand-dark dark:hover:border-brand-teal transition-colors"
              >
                Y-
              </button>
              <button
                @click="rotateModel('y', 1)"
                class="px-2.5 py-1 rounded-full border border-gray-200 dark:border-gray-700 hover:border-brand-dark dark:hover:border-brand-teal transition-colors"
              >
                Y+
              </button>
              <button
                @click="rotateModel('z', -1)"
                class="px-2.5 py-1 rounded-full border border-gray-200 dark:border-gray-700 hover:border-brand-dark dark:hover:border-brand-teal transition-colors"
              >
                Z-
              </button>
              <button
                @click="rotateModel('z', 1)"
                class="px-2.5 py-1 rounded-full border border-gray-200 dark:border-gray-700 hover:border-brand-dark dark:hover:border-brand-teal transition-colors"
              >
                Z+
              </button>
              <button
                @click="resetRotation"
                class="px-2.5 py-1 rounded-full border border-gray-200 dark:border-gray-700 hover:border-brand-dark dark:hover:border-brand-teal transition-colors"
              >
                Reset
              </button>
            </div>
            <div class="flex items-center gap-2">
              <span class="uppercase tracking-wider text-[10px] text-gray-400">Filament</span>
              <button
                @click="toggleFilament"
                class="px-2.5 py-1 rounded-full border border-gray-200 dark:border-gray-700 transition-colors"
                :class="showFilament ? 'bg-brand-dark text-white border-brand-dark dark:bg-brand-teal dark:text-gray-900 dark:border-brand-teal' : 'hover:border-brand-dark dark:hover:border-brand-teal'"
              >
                {{ showFilament ? 'On' : 'Off' }}
              </button>
            </div>
          </div>
          <button
            v-if="store.simulationStlFile"
            @click="triggerFilePick"
            class="mt-2 text-xs font-semibold text-brand-dark dark:text-brand-teal hover:text-gray-600 dark:hover:text-teal-300 transition-colors"
          >
            Change STL File
          </button>
        </div>

        <button
          @click="goToUpload"
          class="pointer-events-auto bg-white/85 dark:bg-gray-900/80 backdrop-blur border border-gray-200/80 dark:border-gray-700/80 text-brand-dark dark:text-gray-100 px-4 py-2 rounded-lg text-sm font-medium shadow-lg hover:bg-brand-dark hover:text-white dark:hover:bg-brand-teal dark:hover:text-gray-900 transition-colors"
        >
          Back to Upload
        </button>
      </div>

      <div class="pointer-events-auto self-center mb-4">
        <div class="bg-white/80 dark:bg-gray-900/80 backdrop-blur border border-gray-200/70 dark:border-gray-700/70 rounded-full px-4 py-2 shadow-xl flex items-center gap-3">
          <button
            @click="togglePlay"
            class="bg-brand-dark dark:bg-brand-teal text-white dark:text-gray-900 px-4 py-2 rounded-full font-semibold text-sm hover:scale-105 transition-transform"
          >
            {{ isPlaying ? 'Pause' : progress >= 1 ? 'Restart' : 'Play' }}
          </button>

          <div class="flex items-center gap-1">
            <button
              v-for="option in speedOptions"
              :key="option"
              @click="speedMultiplier = option"
              class="px-3 py-1.5 rounded-full text-xs font-mono border transition-colors"
              :class="speedMultiplier === option
                ? 'bg-brand-dark text-white border-brand-dark dark:bg-brand-teal dark:text-gray-900 dark:border-brand-teal'
                : 'bg-white/60 dark:bg-gray-800/60 text-gray-500 border-gray-200 dark:border-gray-700 hover:text-brand-dark dark:hover:text-brand-teal'"
            >
              {{ option }}x
            </button>
          </div>

          <div class="text-xs font-mono text-gray-500 dark:text-gray-400">
            {{ Math.round(progress * 100) }}%
          </div>
        </div>
      </div>
    </div>

    <div v-if="!store.simulationStlFile" class="absolute inset-0 flex items-center justify-center bg-white/70 dark:bg-gray-950/70 backdrop-blur-sm">
      <div class="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-xl p-6 max-w-md w-full text-center">
        <h3 class="text-lg font-bold text-brand-dark dark:text-white mb-2">Load a .STL file</h3>
        <p class="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Select the STL file you want to simulate. The simulation will reveal layers in real time.
        </p>
        <button
          @click="triggerFilePick"
          class="inline-flex items-center justify-center px-5 py-3 rounded-full bg-brand-dark dark:bg-brand-teal text-white dark:text-gray-900 font-semibold cursor-pointer hover:scale-105 transition-transform"
        >
          Choose STL File
        </button>
        <p class="mt-3 text-xs text-gray-400">Only .stl files are supported.</p>
      </div>
    </div>

    <div v-if="isLoading" class="absolute inset-0 z-40 flex items-center justify-center bg-white/80 dark:bg-gray-900/80">
      <div class="flex flex-col items-center gap-3">
        <div class="w-10 h-10 border-4 border-brand-teal border-t-transparent rounded-full animate-spin"></div>
        <p class="text-sm font-mono text-gray-500 dark:text-gray-400">Parsing STL...</p>
      </div>
    </div>

    <div v-if="loadError" class="absolute bottom-4 left-1/2 -translate-x-1/2 bg-red-50 dark:bg-red-900/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-200 text-sm px-4 py-2 rounded-lg shadow">
      {{ loadError }}
    </div>
  </div>
</template>
