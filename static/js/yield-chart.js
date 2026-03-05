/**
 * Yield Over Time - Dynamic Area Chart
 * =====================================
 * Apache ECharts integration for farming yield analytics
 * Dark theme with neon green (#00FF44) and bright orange (#FF6600)
 */

class YieldChart {
    constructor(containerId = 'yield-chart-container') {
        this.containerId = containerId;
        this.chart = null;
        this.data = [];
        this.init();
    }

    /**
     * Initialize chart on page load
     */
    init() {
        const container = document.getElementById(this.containerId);
        if (!container) {
            console.warn(`[YieldChart] Container #${this.containerId} not found`);
            return;
        }

        // Load ECharts from CDN if not already loaded
        if (typeof echarts === 'undefined') {
            this.loadEChartsLibrary().then(() => this.render());
        } else {
            this.render();
        }
    }

    /**
     * Load ECharts library from CDN
     */
    loadEChartsLibrary() {
        return new Promise((resolve, reject) => {
            if (typeof echarts !== 'undefined') {
                resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js';
            script.onload = () => {
                console.log('[YieldChart] ✅ ECharts library loaded from CDN');
                resolve();
            };
            script.onerror = () => {
                console.error('[YieldChart] Failed to load ECharts from CDN');
                reject(new Error('ECharts CDN unavailable'));
            };
            document.head.appendChild(script);
        });
    }

    /**
     * Generate sample yield data for demo
     * In production, this would come from backend API
     */
    generateDemoData() {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const yield2024 = [2.1, 2.3, 2.5, 2.8, 3.1, 3.4, 3.6, 3.8, 3.5, 3.2, 2.9, 2.6]; // tons/hectare
        const yield2025 = [2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.1, 3.8, 3.5, 3.2, 2.9]; // Improved yield
        
        return {
            months,
            series: [
                {
                    name: 'Yield 2024',
                    data: yield2024,
                    color: '#FF6600', // Bright orange
                },
                {
                    name: 'Yield 2025',
                    data: yield2025,
                    color: '#00FF44', // Neon green
                },
            ],
        };
    }

    /**
     * Dark theme configuration with accessibility
     */
    getDarkTheme() {
        return {
            // global layout
            textStyle: {
                color: '#E0E0E0',
                fontFamily: "'Inter', sans-serif",
            },
            title: {
                textStyle: {
                    color: '#FFFFFF',
                    fontSize: 16,
                    fontWeight: 'bold',
                },
            },
            line: {
                itemStyle: {
                    borderWidth: 2,
                },
                lineStyle: {
                    width: 3,
                },
                symbolSize: 6,
                smooth: true,
            },
            radar: {
                itemStyle: {
                    borderWidth: 2,
                },
                lineStyle: {
                    width: 2,
                },
                symbolSize: 4,
                smooth: true,
            },
            bar: {
                itemStyle: {
                    barBorderWidth: 0,
                    barBorderColor: '#777',
                },
            },
            pie: {
                itemStyle: {
                    borderWidth: 0,
                    borderColor: '#000',
                },
            },
            boxplot: {
                itemStyle: {
                    borderWidth: 1,
                    borderColor: '#444',
                },
            },
            parallel: {
                itemStyle: {
                    borderWidth: 0,
                    borderColor: '#444',
                },
            },
            sankey: {
                itemStyle: {
                    borderWidth: 0,
                    borderColor: '#444',
                },
            },
            funnel: {
                itemStyle: {
                    borderWidth: 0,
                    borderColor: '#444',
                },
            },
            gauge: {
                itemStyle: {
                    borderWidth: 0,
                    borderColor: '#444',
                },
            },
            candlestick: {
                itemStyle: {
                    color: '#00FF44',
                    color0: '#FF6600',
                    borderColor: '#00FF44',
                    borderColor0: '#FF6600',
                },
            },
            graph: {
                itemStyle: {
                    borderWidth: 0,
                    borderColor: '#444',
                },
                lineStyle: {
                    width: 1,
                    color: '#555',
                },
                symbolSize: 4,
                smooth: true,
            },
            map: {
                itemStyle: {
                    areaColor: '#1E1E1E',
                    borderColor: '#444',
                    borderWidth: 0.5,
                },
                label: {
                    color: '#AAA',
                },
            },
            geo: {
                itemStyle: {
                    areaColor: '#1E1E1E',
                    borderColor: '#444',
                    borderWidth: 0.5,
                },
                label: {
                    color: '#AAA',
                },
            },
            categoryAxis: {
                axisLine: {
                    show: true,
                    lineStyle: {
                        color: '#444',
                        width: 1,
                    },
                },
                axisTick: {
                    show: true,
                    lineStyle: {
                        color: '#444',
                    },
                },
                axisLabel: {
                    show: true,
                    color: '#AAA',
                    fontSize: 11,
                },
                splitLine: {
                    show: false,
                    lineStyle: {
                        color: ['#555'],
                    },
                },
                splitArea: {
                    show: false,
                    areaStyle: {
                        color: ['rgba(250,250,250,0.02)', 'rgba(128,128,128,0.02)'],
                    },
                },
            },
            valueAxis: {
                axisLine: {
                    show: false,
                    lineStyle: {
                        color: '#555',
                    },
                },
                axisTick: {
                    show: false,
                    lineStyle: {
                        color: '#555',
                    },
                },
                axisLabel: {
                    show: true,
                    color: '#AAA',
                    fontSize: 11,
                },
                splitLine: {
                    show: true,
                    lineStyle: {
                        color: ['#333'],
                        width: 1,
                        type: 'solid',
                    },
                },
                splitArea: {
                    show: false,
                    areaStyle: {
                        color: ['rgba(250,250,250,0.02)', 'rgba(128,128,128,0.02)'],
                    },
                },
            },
            logAxis: {
                axisLine: {
                    show: false,
                    lineStyle: {
                        color: '#555',
                    },
                },
                axisTick: {
                    show: false,
                    lineStyle: {
                        color: '#555',
                    },
                },
                axisLabel: {
                    show: true,
                    color: '#AAA',
                },
                splitLine: {
                    show: true,
                    lineStyle: {
                        color: ['#333'],
                    },
                },
                splitArea: {
                    show: false,
                    areaStyle: {
                        color: ['rgba(250,250,250,0.02)', 'rgba(128,128,128,0.02)'],
                    },
                },
            },
            timeAxis: {
                axisLine: {
                    show: true,
                    lineStyle: {
                        color: '#444',
                    },
                },
                axisTick: {
                    show: true,
                    lineStyle: {
                        color: '#444',
                    },
                },
                axisLabel: {
                    show: true,
                    color: '#AAA',
                },
                splitLine: {
                    show: false,
                    lineStyle: {
                        color: ['#555'],
                    },
                },
                splitArea: {
                    show: false,
                    areaStyle: {
                        color: ['rgba(250,250,250,0.02)', 'rgba(128,128,128,0.02)'],
                    },
                },
            },
            toolbox: {
                iconStyle: {
                    borderColor: '#999',
                },
                emphasis: {
                    iconStyle: {
                        borderColor: '#00FF44',
                    },
                },
            },
            legend: {
                textStyle: {
                    color: '#AAA',
                },
            },
            tooltip: {
                axisPointer: {
                    lineStyle: {
                        color: '#333',
                        width: 1,
                    },
                    crossStyle: {
                        color: '#555',
                        width: 1,
                    },
                },
                backgroundColor: '#0A0E27',
                borderColor: '#333',
                borderWidth: 1,
                textStyle: {
                    color: '#E0E0E0',
                },
            },
            timeline: {
                lineStyle: {
                    color: '#555',
                    width: 1,
                },
                itemStyle: {
                    color: '#00FF44',
                    borderWidth: 1,
                },
                controlStyle: {
                    color: '#555',
                    borderColor: '#555',
                    borderWidth: 0.5,
                },
                checkpointStyle: {
                    color: '#00FF44',
                    borderColor: '#00FF44',
                },
                label: {
                    color: '#AAA',
                },
            },
            visualMap: {
                textStyle: {
                    color: '#AAA',
                },
            },
            itemStyle: {
                borderWidth: 0,
            },
            emphasis: {
                itemStyle: {
                    color: '#00FF44',
                    borderColor: '#00FF44',
                    borderWidth: 2,
                },
                label: {
                    color: '#FFF',
                },
            },
            stateAnimation: {
                duration: 300,
                easing: 'cubicOut',
            },
        };
    }

    /**
     * Render the Yield Over Time area chart
     */
    render() {
        const data = this.generateDemoData();
        const container = document.getElementById(this.containerId);
        
        // Initialize chart instance
        this.chart = echarts.init(container, null, {
            useDirtyRect: true,
        });

        // Dark theme
        echarts.registerTheme('dark-agro', this.getDarkTheme());
        this.chart.setOption(
            {
                // Apply dark theme
                backgroundColor: '#0F1419',

                // Title
                title: {
                    text: '📊 Yield Over Time',
                    left: 'center',
                    top: 12,
                    textStyle: {
                        color: '#FFFFFF',
                        fontSize: 18,
                        fontWeight: 'bold',
                        fontFamily: "'Inter', sans-serif",
                    },
                },

                // Tooltip
                tooltip: {
                    trigger: 'axis',
                    backgroundColor: 'rgba(10, 14, 39, 0.95)',
                    borderColor: '#333',
                    borderWidth: 1,
                    textStyle: {
                        color: '#E0E0E0',
                        fontSize: 12,
                    },
                    formatter: (params) => {
                        if (!params || params.length === 0) return '';
                        let html = `<div style="padding: 8px 0;">${params[0].axisValue}</div>`;
                        params.forEach((param) => {
                            const color = param.color;
                            html += `<div style="margin-top: 4px;">
                                <span style="display:inline-block;width:8px;height:8px;background:${color};border-radius:2px;margin-right:6px;"></span>
                                <span>${param.seriesName}:</span>
                                <span style="margin-left:12px;font-weight:700;color:${color};">${param.value.toFixed(2)} t/ha</span>
                            </div>`;
                        });
                        return html;
                    },
                    extraCssText:
                        'box-shadow: 0 4px 12px rgba(0, 255, 68, 0.15); border-radius: 8px;',
                },

                // Legend
                legend: {
                    top: 50,
                    left: 'center',
                    orient: 'horizontal',
                    textStyle: {
                        color: '#AAA',
                        fontSize: 12,
                    },
                    itemGap: 20,
                },

                // Grid
                grid: {
                    top: 90,
                    left: 60,
                    right: 40,
                    bottom: 50,
                    backgroundColor: 'rgba(15, 20, 30, 0.5)',
                    borderColor: '#222',
                    borderWidth: 1,
                },

                // X-Axis
                xAxis: {
                    type: 'category',
                    data: data.months,
                    boundaryGap: false,
                    axisLine: {
                        lineStyle: {
                            color: '#333',
                            width: 1,
                        },
                    },
                    axisTick: {
                        lineStyle: {
                            color: '#333',
                        },
                    },
                    axisLabel: {
                        color: '#888',
                        fontSize: 11,
                        margin: 8,
                    },
                    splitLine: {
                        show: false,
                    },
                },

                // Y-Axis
                yAxis: {
                    type: 'value',
                    name: 'Yield (tons/hectare)',
                    nameTextStyle: {
                        color: '#888',
                        fontSize: 11,
                        align: 'right',
                        padding: [0, 0, 0, 8],
                    },
                    axisLine: {
                        show: false,
                    },
                    axisTick: {
                        show: false,
                    },
                    axisLabel: {
                        color: '#888',
                        fontSize: 11,
                    },
                    splitLine: {
                        lineStyle: {
                            color: '#222',
                            width: 1,
                            type: 'dashed',
                        },
                    },
                    min: 1.5,
                    max: 4.5,
                },

                // Series
                series: [
                    {
                        name: data.series[0].name,
                        type: 'area',
                        data: data.series[0].data,
                        smooth: true,
                        itemStyle: {
                            color: data.series[0].color,
                        },
                        areaStyle: {
                            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                                {
                                    offset: 0,
                                    color: 'rgba(255, 102, 0, 0.4)',
                                },
                                {
                                    offset: 1,
                                    color: 'rgba(255, 102, 0, 0.05)',
                                },
                            ]),
                        },
                        lineStyle: {
                            color: data.series[0].color,
                            width: 3,
                        },
                        symbolSize: 6,
                        emphasis: {
                            itemStyle: {
                                color: '#FFD700',
                                borderColor: '#FFD700',
                                borderWidth: 2,
                            },
                            lineStyle: {
                                width: 4,
                            },
                        },
                    },
                    {
                        name: data.series[1].name,
                        type: 'area',
                        data: data.series[1].data,
                        smooth: true,
                        itemStyle: {
                            color: data.series[1].color,
                        },
                        areaStyle: {
                            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                                {
                                    offset: 0,
                                    color: 'rgba(0, 255, 68, 0.4)',
                                },
                                {
                                    offset: 1,
                                    color: 'rgba(0, 255, 68, 0.05)',
                                },
                            ]),
                        },
                        lineStyle: {
                            color: data.series[1].color,
                            width: 3,
                        },
                        symbolSize: 6,
                        emphasis: {
                            itemStyle: {
                                color: '#00FF44',
                                borderColor: '#00FF44',
                                borderWidth: 2,
                            },
                            lineStyle: {
                                width: 4,
                            },
                        },
                    },
                ],

                // Animation
                animationDuration: 1500,
                animationEasing: 'cubicOut',
            },
            true
        );

        // Handle window resize
        window.addEventListener('resize', () => {
            if (this.chart) {
                this.chart.resize();
            }
        });

        console.log('[YieldChart] ✅ Chart rendered successfully');
    }

    /**
     * Update chart with new data
     * @param {Array} months - Month labels
     * @param {Array} series - Series array with name, data, color
     */
    updateData(months, series) {
        if (!this.chart) {
            console.warn('[YieldChart] Chart not initialized');
            return;
        }

        this.chart.setOption({
            xAxis: {
                data: months,
            },
            series: series.map((s) => ({
                name: s.name,
                data: s.data,
            })),
        });
    }

    /**
     * Fetch yield data from backend API
     */
    async loadFromAPI() {
        try {
            const response = await fetch('/api/yield-history');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const data = await response.json();
            this.updateData(data.months, data.series);
            console.log('[YieldChart] ✅ Data loaded from API');
        } catch (err) {
            console.warn('[YieldChart] API load failed, using demo data:', err);
            // Fall back to demo data (already rendered)
        }
    }

    /**
     * Export chart as PNG image
     */
    exportImage() {
        if (!this.chart) {
            console.warn('[YieldChart] Chart not initialized');
            return;
        }

        const url = this.chart.getDataURL({
            type: 'png',
            pixelRatio: 2,
            backgroundColor: '#0F1419',
        });

        const link = document.createElement('a');
        link.href = url;
        link.download = `yield-chart-${new Date().toISOString().split('T')[0]}.png`;
        link.click();
        console.log('[YieldChart] ✅ Chart exported as PNG');
    }
}

// Auto-initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('yield-chart-container')) {
        window.yieldChart = new YieldChart('yield-chart-container');
    }
});
