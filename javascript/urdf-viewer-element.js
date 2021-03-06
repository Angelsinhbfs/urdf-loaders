// urdf-viewer element
// Loads and displays a 3D view of a URDF-formatted robot

// Events
// urdf-processed: Fires when the URDF has finished loading and getting processed
// geometry-loaded: Fires when all the geometry has been fully loaded
class URDFViewer extends HTMLElement {

    static get observedAttributes() {
        return ['package', 'urdf', 'up', 'display-shadow', 'ambient-color']
    }

    get package() { return this.getAttribute('package') || '' }
    set package(val) { this.setAttribute('package', val) } 
    
    get urdf() { return this.getAttribute('urdf') || '' }
    set urdf(val) { this.setAttribute('urdf', val) }

    get up() { return this.getAttribute('up') || '+Y' }
    set up(val) { this.setAttribute('up', val) }

    get displayShadow() { return this.hasAttribute('display-shadow') || false }
    set displayShadow(val) {
        val = !!val
        val ? this.setAttribute('display-shadow', '') : this.removeAttribute('display-shadow')
    }

    get ambientColor() { return this.getAttribute('ambient-color') || '#455A64' }
    set ambientColor(val) {
        val ? this.setAttribute('ambient-color', val) : this.removeAttribute('ambient-color')
    }

    get angles() {
        const angles = {}
        this._robots.forEach(r => {
            for (let name in r.urdf.joints) angles[name] = r.urdf.joints[name].urdf.angle
        })
        return angles
    }
    set angles(val) { this._setAngles(val) }

    /* Lifecycle Functions */
    constructor() {
        super()

        this._robots = []
        this._requestId = 0
        this._dirty = false

        // Scene setup
        const scene = new THREE.Scene()

        const ambientLight = new THREE.AmbientLight(this.ambientColor)
        scene.add(ambientLight)

        // Light setup
        const dirLight = new THREE.DirectionalLight(0xffffff)
        dirLight.position.set(.4, 1, .1)
        dirLight.shadow.mapSize.width = 2048
        dirLight.shadow.mapSize.height = 2048
        dirLight.castShadow = true
        
        scene.add(dirLight)

        // Renderer setup
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
        renderer.setClearColor(0xffffff)
        renderer.setClearAlpha(0)
        renderer.shadowMap.enabled = true

        // Camera setup
        const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000)
        camera.position.z = -10

        // World setup
        const world = new THREE.Object3D()
        scene.add(world)

        const plane = new THREE.Mesh(
            new THREE.PlaneBufferGeometry( 40, 40 ),
            new THREE.ShadowMaterial( { side: THREE.DoubleSide, transparent: true, opacity: 0.25 } )
        )
        plane.rotation.x = -Math.PI/2
        plane.position.y = -0.5
        plane.receiveShadow = true
        plane.scale.set(10, 10, 10)
        scene.add(plane)

        // Controls setup
        const controls = new THREE.OrbitControls(camera, renderer.domElement)
        controls.rotateSpeed = 2.0
        controls.zoomSpeed = 5
        controls.panSpeed = 2
        controls.enableZoom = true
        controls.enablePan = true
        controls.enableDamping = false
        controls.maxDistance = 50
        controls.minDistance = 0.25
        controls.addEventListener('change', () => this._dirty = true)
        
        this.world = world
        this.renderer = renderer
        this.camera = camera
        this.controls = controls
        this.plane = plane
        this.ambientLight = ambientLight

        const _do = () => {
            if(this.parentNode) {
                this.controls.update()
                if (this._dirty) {
                    this._updatePlane()
                    this.renderer.render(scene, camera)
                    this._dirty = false
                }
            }
            this._renderLoopId = requestAnimationFrame(_do)
        }
        _do()

        // set up the canvas
        window.addEventListener('resize', () => this.refresh())
    }

    connectedCallback() {
        // Add our initialize styles for the element if they haven't
        // been added yet
        if (!this.constructor._styletag) {
            const styletag = document.createElement('style')
            styletag.innerHTML =
            `
                ${this.tagName} { display: block; }
                ${this.tagName} canvas {
                    width: 100%;
                    height: 100%;
                }
            `
            document.head.appendChild(styletag)
            this.constructor._styletag = styletag
        }

        // add the renderer
        if (this.childElementCount === 0) {
            this.appendChild(this.renderer.domElement)
        }

        this.refresh()
        requestAnimationFrame(() => this.refresh())
    }

    disconnectedCallback() {
        cancelAnimationFrame(this._renderLoopId)
    }

    attributeChangedCallback(attr, oldval, newval) {
        this._dirty = true

        switch(attr) {
            case 'package':
            case 'urdf': {
                this._loadUrdf(this.package, this.urdf)
                break
            }

            case 'up': {
                this._setUp(this.up)
                break
            }

            case 'ambient-color': {
                this.ambientLight.color.set(this.ambientColor)
                break
            }
        }
    }

    /* Public API */
    refresh() {
        const r = this.renderer
        const w = this.clientWidth
        const h = this.clientHeight
        const currsize = r.getSize()

        if (currsize.width != w || currsize.height != h) {
            this._dirty = true
        }

        r.setPixelRatio(window.devicePixelRatio)
        r.setSize(w, h, false)

        this.camera.aspect = w / h
        this.camera.updateProjectionMatrix();
    }

    // Set the joint with jointname to
    // angle in degrees
    setAngle(jointname, angle) {
        this._robots.forEach(r => {
            const joint = r.urdf.joints[jointname]
            if (joint) joint.urdf.setAngle(angle)
        })
        this._dirty = true
    }
    
    setAngles(angles) {
        for(name in angles) this.setAngle(name, angles[name])
    }

    /* Private Functions */
    // Updates the position of the plane to be at the
    // lowest point below the robot
    _updatePlane() {
        this.plane.visible = this.displayShadow
        if(this._robots && this.displayShadow) {
            let lowestPoint = Infinity
            this._robots.forEach(r => {
                const bbox = new THREE.Box3().setFromObject(r)
                lowestPoint = Math.min(lowestPoint, bbox.min.y)
            })
            this.plane.position.y = lowestPoint
        }
    }

    // Watch the package and urdf field and load the 
    _loadUrdf(pkg, urdf) {
        const _dispose = item => {
            if (item.parent) item.parent.remove(item)
            if (item.dispose) item.dispose()
            item.children.forEach(c => _dispose(c))
        }

        if (this._prevload === `${pkg}|${urdf}`) return

        this._robots.forEach(r => _dispose(r))

        if (pkg && urdf) {
            this._prevload = `${pkg}|${urdf}`

            // Keep track of this request and make
            // sure it doesn't get overwritten by
            // a subsequent one
            this._requestId ++
            const requestId = this._requestId

            let totalMeshes = 0
            let meshesLoaded = 0
            URDFLoader.load(
                pkg,
                urdf,
                
                // Callback with array of robots
                arr => {
                    // If another request has come in to load a new
                    // robot, then ignore this one
                    if (this._requestId !== requestId) {
                        arr.forEach(r => _dispose(r))
                        return
                    }

                    this._robots = arr
                    arr.forEach(r => this.world.add(r))

                    this.dispatchEvent(new CustomEvent('urdf-processed', { bubbles: true, cancelable: true, composed: true }))
                },

                // Load meshes and enable shadow casting
                (path, ext, done) => {
                    totalMeshes++
                    URDFLoader.defaultMeshLoader(path, ext, mesh => {
                        const _enableShadows = o => {
                            if (o instanceof THREE.Mesh) {
                                o.castShadow = true
                            }
                            o.children.forEach(c => _enableShadows(c))
                        }
                        _enableShadows(mesh)
                        done(mesh)

                        meshesLoaded++
                        if (meshesLoaded === totalMeshes && this._requestId === requestId) {
                            this.dispatchEvent(new CustomEvent('geometry-loaded', { bubbles: true, cancelable: true, composed: true }))
                        }

                        this._dirty = true
                    })
            },
            { mode: 'cors', credentials: 'same-origin' })
        }
    }

    // Watch the coordinate frame and update the
    // rotation of the scene to match
    _setUp(up) {
        if (!up) up = '+Y'
        up = up.toUpperCase()
        const sign = up.replace(/[^-+]/g, '')[0] || '+'
        const axis = up.replace(/[^XYZ]/gi, '')[0] || 'Y'

        const PI = Math.PI
        const HALFPI = PI / 2
        if (axis === 'X') this.world.rotation.set(0, 0, sign === '+' ? HALFPI : -HALFPI)
        if (axis === 'Z') this.world.rotation.set(sign === '+' ? HALFPI : -HALFPI, 0, 0)
        if (axis === 'Y') this.world.rotation.set(sign === '+' ? 0 : PI, 0, 0)
    }
}

window.URDFViewer = URDFViewer
