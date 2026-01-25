/**
 * Interactive Star Pattern Particle Network
 * Creates a dynamic constellation that disperses on mouse proximity
 */

class ParticleNetwork {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.particles = [];
        this.mouse = { x: 0, y: 0, active: false };
        this.repelRadius = 150;
        this.particleCount = 80;
        
        this.init();
    }

    init() {
        // Setup canvas
        this.canvas.id = 'particle-network';
        this.canvas.className = 'particle-canvas';
        this.canvas.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: -2;
            mix-blend-mode: screen;
        `;
        document.body.prepend(this.canvas);

        // Set canvas size
        this.resize();
        window.addEventListener('resize', () => this.resize());

        // Mouse tracking
        document.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        document.addEventListener('mouseleave', () => this.mouse.active = false);
        document.addEventListener('mouseenter', () => this.mouse.active = true);

        // Initialize particles
        this.createParticles();

        // Start animation loop
        this.animate();
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    handleMouseMove(e) {
        this.mouse.x = e.clientX;
        this.mouse.y = e.clientY;
        this.mouse.active = true;
    }

    createParticles() {
        this.particles = [];
        for (let i = 0; i < this.particleCount; i++) {
            this.particles.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                vx: (Math.random() - 0.5) * 0.3,
                vy: (Math.random() - 0.5) * 0.3,
                ax: 0,
                ay: 0,
                radius: Math.random() * 1.5 + 0.5,
                originalX: 0,
                originalY: 0,
                color: this.randomColor(),
            });
        }
    }

    randomColor() {
        const colors = [
            'rgba(217, 70, 239, 0.8)',      // Primary pink/magenta
            'rgba(224, 121, 249, 0.7)',     // Light magenta
            'rgba(192, 38, 211, 0.9)',      // Purple
            'rgba(217, 70, 239, 0.6)',      // Faded primary
        ];
        return colors[Math.floor(Math.random() * colors.length)];
    }

    update() {
        this.particles.forEach((particle, i) => {
            // Apply drag/friction
            particle.vx *= 0.95;
            particle.vy *= 0.95;

            // Mouse repulsion force
            if (this.mouse.active) {
                const dx = particle.x - this.mouse.x;
                const dy = particle.y - this.mouse.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < this.repelRadius) {
                    const force = (this.repelRadius - dist) / this.repelRadius;
                    const angle = Math.atan2(dy, dx);
                    
                    particle.vx += Math.cos(angle) * force * 3;
                    particle.vy += Math.sin(angle) * force * 3;
                }
            }

            // Apply velocity
            particle.x += particle.vx;
            particle.y += particle.vy;

            // Bounce off edges
            if (particle.x < 0) { particle.x = 0; particle.vx *= -0.8; }
            if (particle.x > this.canvas.width) { particle.x = this.canvas.width; particle.vx *= -0.8; }
            if (particle.y < 0) { particle.y = 0; particle.vy *= -0.8; }
            if (particle.y > this.canvas.height) { particle.y = this.canvas.height; particle.vy *= -0.8; }

            // Draw particle
            const gradient = this.ctx.createRadialGradient(
                particle.x, particle.y, 0,
                particle.x, particle.y, particle.radius * 4
            );
            gradient.addColorStop(0, particle.color);
            gradient.addColorStop(0.5, particle.color.replace('0.8', '0.4').replace('0.7', '0.35').replace('0.9', '0.45').replace('0.6', '0.3'));
            gradient.addColorStop(1, 'rgba(147, 51, 234, 0)');

            this.ctx.fillStyle = gradient;
            this.ctx.beginPath();
            this.ctx.arc(particle.x, particle.y, particle.radius * 4, 0, Math.PI * 2);
            this.ctx.fill();
        });

        // Draw connections between particles
        this.drawConnections();
    }

    drawConnections() {
        const connectionDistance = 120;
        const particles = this.particles;

        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                if (distance < connectionDistance) {
                    const opacity = (1 - distance / connectionDistance) * 0.3;
                    this.ctx.strokeStyle = `rgba(217, 70, 239, ${opacity})`;
                    this.ctx.lineWidth = 0.5;
                    this.ctx.beginPath();
                    this.ctx.moveTo(particles[i].x, particles[i].y);
                    this.ctx.lineTo(particles[j].x, particles[j].y);
                    this.ctx.stroke();
                }
            }
        }
    }

    animate() {
        // Fade trail effect
        this.ctx.fillStyle = 'rgba(10, 10, 10, 0.05)';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.update();
        requestAnimationFrame(() => this.animate());
    }
}

// Initialize particle network when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new ParticleNetwork();
    });
} else {
    new ParticleNetwork();
}
